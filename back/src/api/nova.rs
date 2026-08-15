//! Endpoints NoVa : liste des nominations scénario `.scn` disponibles pour le dataset actif.
//! Point d'entrée du picker de scénario (interface Natran) — l'id renvoyé correspond au
//! `scenario_id` attendu par la simulation WS pour activer les diagnostics pression.

use std::collections::HashMap;
use std::path::Path;

use axum::{Json, extract::State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

use super::{
    ApiError, SharedState, active_dataset_id, active_gas_composition, active_network,
    resolve_simulation_demands, sync_compressor_map_mode_for_solve,
};

#[derive(Debug, Clone, Serialize)]
pub(super) struct NovaScenarioSummary {
    /// Identifiant à passer comme `options.scenario_id` au démarrage WS.
    pub id: String,
    /// Nom du fichier (ex. `nomination_mild_618.scn`).
    pub filename: String,
    /// Chemin relatif au dat_dir (vide pour les nominations importées en base).
    #[serde(default)]
    pub relative_path: String,
    /// Origine : `bundled` (fichier `.scn` sous dat_dir) ou `imported` (SQLite).
    #[serde(default = "default_source_bundled")]
    pub source: String,
}

fn default_source_bundled() -> String {
    "bundled".to_string()
}

#[derive(Debug, Deserialize)]
pub(super) struct ImportNominationRequest {
    pub filename: String,
    /// Contenu XML brut du `.scn`.
    pub xml: String,
    /// Dataset cible (défaut : dataset actif).
    #[serde(default)]
    pub dataset_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ReducedNominationRequest {
    /// Scénario `.scn` source (bundlé ou importé).
    pub base_scenario_id: String,
    /// Débits réduits par sink (Nm³/s, signé ou absolu).
    pub reduced_demands: HashMap<String, f64>,
    /// Nom du fichier `.scn` produit (défaut : `{stem}_reduit.scn`).
    #[serde(default)]
    pub filename: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct NovaCapacityRequest {
    /// Identifiant du scénario `.scn` (ex. `nomination_mild_618`).
    pub scenario_id: String,
    /// Sinks à étudier. Si absent → sinks marginaux par défaut présents dans le scénario.
    #[serde(default)]
    pub sink_ids: Option<Vec<String>>,
    /// Pas de dichotomie (défaut 6). Coût = (1 + pas) × solves par sink.
    #[serde(default)]
    pub bisection_steps: Option<usize>,
    /// Mode robuste (continuation de charge) — recommandé sur grands réseaux transport.
    #[serde(default)]
    pub robust_mode: Option<bool>,
    /// Itérations Newton max par solve.
    #[serde(default)]
    pub max_iter: Option<usize>,
}

fn api_error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            error: message.into(),
        }),
    )
}

const MAX_SINKS: usize = 12;
const DEFAULT_BISECTION_STEPS: usize = 6;
const MAX_BISECTION_STEPS: usize = 16;

/// Étude capacité NoVa : débit max faisable par sink (dichotomie sous bornes pression).
/// Coûteuse (plusieurs solves) — gardée par le sémaphore de slots simulation.
pub(super) async fn post_nova_capacity(
    State(state): State<SharedState>,
    Json(payload): Json<NovaCapacityRequest>,
) -> Result<Json<Vec<crate::solver::SinkCapacityReport>>, (StatusCode, Json<ApiError>)> {
    let dataset_id = active_dataset_id(&state);
    let scenario_id = payload.scenario_id.trim();
    if scenario_id.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "scenario_id must not be empty",
        ));
    }
    let scenario_xml = super::resolve_scenario_xml(&state, &dataset_id, scenario_id)
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                format!(
                    "scénario {} introuvable pour le dataset {}",
                    scenario_id, dataset_id
                ),
            )
        })?;

    let network = active_network(&state);
    let gas = active_gas_composition(&state);
    let bisection_steps = payload
        .bisection_steps
        .filter(|n| *n > 0)
        .map(|n| n.min(MAX_BISECTION_STEPS))
        .unwrap_or(DEFAULT_BISECTION_STEPS);
    let robust = payload.robust_mode.unwrap_or(true);
    let max_iter = payload.max_iter.unwrap_or(400);

    let sink_ids: Vec<String> = payload
        .sink_ids
        .map(|mut ids| {
            ids.truncate(MAX_SINKS);
            ids
        })
        .unwrap_or_else(|| {
            crate::solver::nova_capacity::default_marginal_sink_ids()
                .into_iter()
                .map(|s| s.to_string())
                .collect()
        });

    let preset = crate::solver::preset_from_request(
        network.node_count(),
        robust,
        max_iter,
        1e-3,
        120_000,
        1,
        None,
    );

    let permit = state
        .simulation_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "simulation capacity reached, retry later",
            )
        })?;

    let pool = state.rayon_pool.clone();
    let state_for_mode = state.clone();
    let join_result: Result<
        Result<Vec<crate::solver::SinkCapacityReport>, (StatusCode, Json<ApiError>)>,
        tokio::task::JoinError,
    > = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let mut scenario = crate::gaslib::parse_scenario_demands_from_str(&scenario_xml)
            .map_err(|err| api_error(StatusCode::UNPROCESSABLE_ENTITY, format!("{err:#}")))?;
        crate::gaslib::enrich_scenario_with_balance_hub(&network, &mut scenario);
        pool.install(|| {
            sync_compressor_map_mode_for_solve(&state_for_mode);
            crate::solver::study_sinks_capacity(
                &network,
                &scenario,
                &sink_ids,
                &preset,
                gas,
                bisection_steps,
            )
        })
        .map_err(|err| api_error(StatusCode::UNPROCESSABLE_ENTITY, format!("{err:#}")))
    })
    .await;

    let inner = join_result
        .map_err(|err| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join: {err}")))?;
    Ok(Json(inner?))
}

/// Liste les `.scn` disponibles pour le dataset actif : bundlés (filesystem récursif)
/// + importés (SQLite). Dédup par id ; les bundlés priment sur les importés en cas de
/// collision de stem (réservé : normalement les ids importés sont préfixés `imported-`).
pub(super) async fn list_nova_scenarios(
    State(state): State<SharedState>,
) -> Json<Vec<NovaScenarioSummary>> {
    let dataset_id = super::active_dataset_id(&state);
    let dat_dir = state.data_dir.clone();
    let mut out: Vec<NovaScenarioSummary> = Vec::new();
    collect_scenarios(&dat_dir, &dat_dir, &mut out);
    // Nominations importées (SQLite).
    if let Ok(imported) = state.scenario_repo.list_imported_nominations(&dataset_id) {
        for rec in imported {
            out.push(NovaScenarioSummary {
                id: rec.id,
                filename: rec.filename,
                relative_path: String::new(),
                source: "imported".to_string(),
            });
        }
    }
    // Tri déterministe : nom de fichier.
    out.sort_by(|a, b| a.filename.cmp(&b.filename));
    // Dédup par id (stem) : deux `.scn` de même stem produiraient deux options de même
    // valeur pour le `q-select` (emit-value). On garde le premier après tri.
    out.dedup_by(|a, b| a.id == b.id);
    Json(out)
}

fn file_stem(name: &str) -> String {
    name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name).to_string()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `POST /api/nova/nominations` : importe un fichier `.scn` fourni (XML brut).
/// Valide le parsing puis persiste en base. Retourne le résumé utilisable comme
/// `scenario_id` dans la simulation WS.
pub(super) async fn post_import_nomination(
    State(state): State<SharedState>,
    Json(payload): Json<ImportNominationRequest>,
) -> Result<Json<NovaScenarioSummary>, (StatusCode, Json<ApiError>)> {
    let filename = payload.filename.trim();
    if filename.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "filename must not be empty",
        ));
    }
    if !filename.ends_with(".scn") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "filename must end with .scn",
        ));
    }
    // Validation : on doit pouvoir parser le XML.
    if let Err(err) = crate::gaslib::parse_scenario_demands_from_str(&payload.xml) {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("invalid .scn XML: {err:#}"),
        ));
    }

    let dataset_id = payload
        .dataset_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| super::active_dataset_id(&state));
    let stem = file_stem(filename);
    let id = format!("imported-{stem}-{}", now_ms());
    let created_at_ms = now_ms();

    let record = crate::store::ImportedNominationRecord {
        id: id.clone(),
        dataset_id,
        filename: filename.to_string(),
        source: "imported".to_string(),
        created_at_ms,
        xml: payload.xml,
    };
    state
        .scenario_repo
        .insert_imported_nomination(&record)
        .map_err(|err| api_error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    Ok(Json(NovaScenarioSummary {
        id,
        filename: filename.to_string(),
        relative_path: String::new(),
        source: "imported".to_string(),
    }))
}

fn reduced_nomination_stem(base_scenario_id: &str) -> String {
    let mut stem = file_stem(base_scenario_id);
    if stem.is_empty() {
        stem = base_scenario_id.to_string();
    }
    // Évite `imported-imported-…_reduit` quand la base est déjà une importée.
    while let Some(stripped) = stem.strip_prefix("imported-") {
        stem = stripped.to_string();
    }
    if stem.is_empty() {
        "nomination".to_string()
    } else {
        stem
    }
}

/// `POST /api/nova/nominations/reduced` : dérive une nomination `.scn` à partir d'une base
/// en substituant les débits max faisables sur les sinks concernés.
pub(super) async fn post_reduced_nomination(
    State(state): State<SharedState>,
    Json(payload): Json<ReducedNominationRequest>,
) -> Result<Json<NovaScenarioSummary>, (StatusCode, Json<ApiError>)> {
    if payload.base_scenario_id.trim().is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "base_scenario_id must not be empty",
        ));
    }
    if payload.reduced_demands.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "reduced_demands must not be empty",
        ));
    }
    for (node_id, q) in &payload.reduced_demands {
        if !q.is_finite() {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                format!("reduced_demands[{node_id}] must be a finite number"),
            ));
        }
    }

    let dataset_id = super::active_dataset_id(&state);
    let base_scenario_id = payload.base_scenario_id.trim().to_string();
    let base_xml = super::resolve_scenario_xml(&state, &dataset_id, &base_scenario_id)
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                format!(
                    "scénario {} introuvable pour le dataset {}",
                    base_scenario_id, dataset_id
                ),
            )
        })?;

    let patched_xml = crate::gaslib::apply_reduced_demands_to_scn_xml(
        &base_xml,
        &payload.reduced_demands,
    )
    .map_err(|err| api_error(StatusCode::UNPROCESSABLE_ENTITY, format!("{err:#}")))?;

    if let Err(err) = crate::gaslib::parse_scenario_demands_from_str(&patched_xml) {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("invalid reduced .scn XML: {err:#}"),
        ));
    }

    let stem = reduced_nomination_stem(&base_scenario_id);
    let mut filename = payload
        .filename
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{stem}_reduit.scn"));
    if !filename.to_ascii_lowercase().ends_with(".scn") {
        filename.push_str(".scn");
    }

    let ts = now_ms();
    let id = format!("imported-{stem}_reduit-{ts}");
    let record = crate::store::ImportedNominationRecord {
        id: id.clone(),
        dataset_id,
        filename: filename.clone(),
        source: "imported".to_string(),
        created_at_ms: ts,
        xml: patched_xml,
    };
    state
        .scenario_repo
        .insert_imported_nomination(&record)
        .map_err(|err| api_error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    Ok(Json(NovaScenarioSummary {
        id,
        filename,
        relative_path: String::new(),
        source: "imported".to_string(),
    }))
}

/// `DELETE /api/nova/nominations/{id}` : supprime une nomination importée.
pub(super) async fn delete_import_nomination(
    State(state): State<SharedState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    let removed = state
        .scenario_repo
        .delete_imported_nomination(&id)
        .map_err(|err| api_error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;
    if !removed {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            format!("nomination not found: {id}"),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

// --- Comparaison de 2 nominations ---

#[derive(Debug, Deserialize)]
pub(super) struct CompareNominationsRequest {
    pub scenario_a_id: String,
    pub scenario_b_id: String,
    #[serde(default)]
    pub robust_mode: Option<bool>,
    #[serde(default)]
    pub max_iter: Option<usize>,
    #[serde(default)]
    pub tolerance: Option<f64>,
}

#[derive(Debug, Serialize)]
pub(super) struct NominationSolveOutcome {
    pub scenario_id: String,
    pub feasible: bool,
    pub cause: String,
    pub deficit_sinks: Vec<String>,
    pub pressures: HashMap<String, f64>,
    pub flows: HashMap<String, f64>,
    pub pressure_slips: Vec<crate::solver::ScenarioPressureSlip>,
    pub iterations: usize,
    pub residual: f64,
    #[serde(default)]
    pub solver_signature: String,
    #[serde(default)]
    pub solver_established: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub demand_scale_achieved: Option<f64>,
}

#[derive(Debug, Serialize)]
pub(super) struct CompareNominationsResponse {
    pub scenario_a_id: String,
    pub scenario_b_id: String,
    pub outcome_a: NominationSolveOutcome,
    pub outcome_b: NominationSolveOutcome,
    pub delta_pressures: HashMap<String, f64>,
    pub delta_flows: HashMap<String, f64>,
    pub shared_deficit_sinks: Vec<String>,
    pub max_abs_delta_p_bar: f64,
    pub max_abs_delta_q_m3s: f64,
    pub nodes_compared: usize,
    pub pipes_compared: usize,
}

const NOVA_VALIDATE_LIMITATIONS: &[&str] = &[
    "GazFlow est un outil d'étude comparative, non certifié.",
    "NotSolvedLocal ne prouve pas l'infaisabilité physique.",
];

#[derive(Debug, Deserialize)]
pub(super) struct ValidateNominationRequest {
    pub scenario_id: String,
    /// Overrides de soutirage (Nm³/s). Un `0` explicite coupe le sink.
    #[serde(default)]
    pub demands: Option<HashMap<String, f64>>,
    #[serde(default)]
    pub robust_mode: Option<bool>,
    #[serde(default)]
    pub max_iter: Option<usize>,
    #[serde(default)]
    pub tolerance: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct CompactDeficit {
    pub node_id: String,
    pub solved_pressure_bar: f64,
    pub required_lower_bar: Option<f64>,
    pub shortfall_bar: f64,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct NovaValidateResponse {
    pub ok: bool,
    pub network_id: String,
    pub nomination_id: String,
    pub feasible: bool,
    pub cause: String,
    pub deficit_sinks: Vec<String>,
    pub solver_signature: String,
    pub solver_established: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub demand_scale_achieved: Option<f64>,
    pub min_pressure_bar: f64,
    pub max_pressure_bar: f64,
    pub worst_shortfall_bar: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worst_sink: Option<String>,
    pub deficit_details: Vec<CompactDeficit>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub applied_overrides: HashMap<String, f64>,
    pub limitations: Vec<String>,
}

fn nova_cause_label(cause: crate::solver::NovaCause) -> &'static str {
    match cause {
        crate::solver::NovaCause::Feasible => "Feasible",
        crate::solver::NovaCause::PressureDeficit => "PressureDeficit",
        crate::solver::NovaCause::PressureExcess => "PressureExcess",
        crate::solver::NovaCause::PressureReachability => "PressureReachability",
        crate::solver::NovaCause::NotSolvedLocal => "NotSolvedLocal",
        crate::solver::NovaCause::ScaleNotAchieved => "ScaleNotAchieved",
    }
}

fn nova_signature_label(signature: crate::solver::NovaSolverSignature) -> &'static str {
    match signature {
        crate::solver::NovaSolverSignature::NewtonPosthoc => "NewtonPosthoc",
        crate::solver::NovaSolverSignature::IpoptEscalation => "IpoptEscalation",
        crate::solver::NovaSolverSignature::Unresolved => "Unresolved",
    }
}

fn demands_have_non_finite(demands: &HashMap<String, f64>) -> bool {
    demands.values().any(|value| !value.is_finite())
}

fn compact_validate_response(
    network_id: String,
    nomination_id: String,
    outcome: &NominationSolveOutcome,
    applied_overrides: HashMap<String, f64>,
    demand_scale_achieved: Option<f64>,
    solver_signature: &str,
    solver_established: bool,
) -> NovaValidateResponse {
    let mut min_p = f64::INFINITY;
    let mut max_p = f64::NEG_INFINITY;
    for pressure in outcome.pressures.values() {
        if pressure.is_finite() && *pressure > 0.0 {
            min_p = min_p.min(*pressure);
            max_p = max_p.max(*pressure);
        }
    }
    if !min_p.is_finite() {
        min_p = 0.0;
        max_p = 0.0;
    }

    let mut deficit_details: Vec<CompactDeficit> = outcome
        .pressure_slips
        .iter()
        .filter(|slip| slip.shortfall_bar > 0.0)
        .map(|slip| CompactDeficit {
            node_id: slip.node_id.clone(),
            solved_pressure_bar: slip.solved_pressure_bar,
            required_lower_bar: slip.lower_bar,
            shortfall_bar: slip.shortfall_bar,
        })
        .collect();
    deficit_details.sort_by(|a, b| b.shortfall_bar.total_cmp(&a.shortfall_bar));
    deficit_details.truncate(12);

    let (worst_sink, worst_shortfall_bar) = deficit_details
        .first()
        .map(|row| (Some(row.node_id.clone()), row.shortfall_bar))
        .unwrap_or((None, 0.0));

    let mut limitations: Vec<String> = NOVA_VALIDATE_LIMITATIONS
        .iter()
        .map(|item| (*item).to_string())
        .collect();
    if outcome.cause == "NotSolvedLocal" {
        limitations.push(
            "Le Newton local n'a pas établi de point de fonctionnement ; ne pas conclure à l'infaisabilité."
                .to_string(),
        );
    }

    NovaValidateResponse {
        ok: true,
        network_id,
        nomination_id,
        feasible: outcome.feasible,
        cause: outcome.cause.clone(),
        deficit_sinks: outcome.deficit_sinks.clone(),
        solver_signature: solver_signature.to_string(),
        solver_established,
        demand_scale_achieved,
        min_pressure_bar: min_p,
        max_pressure_bar: max_p,
        worst_shortfall_bar,
        worst_sink,
        deficit_details,
        applied_overrides,
        limitations,
    }
}

/// Résout une nomination NoVa avec des demandes déjà fusionnées (overrides y compris Q=0).
fn run_nova_solve_with_demands(
    network: &crate::graph::GasNetwork,
    scenario: &crate::gaslib::ScenarioDemands,
    demands: &HashMap<String, f64>,
    gas: crate::solver::GasComposition,
    max_iter: usize,
    tolerance: f64,
    robust: bool,
) -> Result<NominationSolveOutcome, String> {
    let preset = crate::solver::preset_from_request(
        network.node_count(),
        robust,
        max_iter,
        tolerance,
        120_000,
        1,
        None,
    );
    let result = crate::solver::solve_steady_state_with_preset(
        network,
        &demands,
        None,
        &preset,
        gas,
        |_| crate::solver::SolverControl::Continue,
        None::<fn(crate::solver::ContinuationStepEvent)>,
    )
    .map_err(|err| format!("{err:#}"))?;

    let diag = crate::solver::compute_nova_diagnostics(network, scenario, &result);
    let converged = result.residual <= preset.tolerance;
    let verdict = super::nova_finalize::finalize_nova_verdict(
        network,
        Some(scenario),
        &demands,
        gas,
        &diag,
        converged,
        preset.tolerance,
        &result,
    );
    Ok(NominationSolveOutcome {
        scenario_id: String::new(),
        feasible: verdict.feasible,
        cause: nova_cause_label(verdict.cause).to_string(),
        deficit_sinks: verdict.deficit_sinks.clone(),
        pressures: result.pressures.clone(),
        flows: result.flows.clone(),
        pressure_slips: diag.pressure_slips,
        iterations: result.iterations,
        residual: result.residual,
        solver_signature: nova_signature_label(verdict.solver_signature).to_string(),
        solver_established: verdict.converged,
        demand_scale_achieved: verdict.demand_scale_achieved,
    })
}

/// Résout une nomination NoVa (steady-state + diagnostics + verdict) pour comparaison.
/// Version simplifiée du pipeline WS (sans routage CDF transport) : adaptée à l'analyse
/// comparative de scénarios sur le réseau actif.
fn run_nova_solve_for_compare(
    network: &crate::graph::GasNetwork,
    scenario: &crate::gaslib::ScenarioDemands,
    gas: crate::solver::GasComposition,
    max_iter: usize,
    tolerance: f64,
    robust: bool,
) -> Result<NominationSolveOutcome, String> {
    let demands = crate::gaslib::effective_solver_demands_for_network(
        network,
        &scenario.demands,
        scenario,
    );
    run_nova_solve_with_demands(
        network, scenario, &demands, gas, max_iter, tolerance, robust,
    )
}

/// Newton non convergé → verdict compact NotSolvedLocal (pas une 422 HTTP).
fn outcome_from_unconverged_solve(
    scenario_id: String,
    err: String,
) -> Result<NominationSolveOutcome, String> {
    if !err.contains("did not converge") {
        return Err(err);
    }
    Ok(NominationSolveOutcome {
        scenario_id,
        feasible: false,
        cause: "NotSolvedLocal".to_string(),
        deficit_sinks: Vec::new(),
        pressures: HashMap::new(),
        flows: HashMap::new(),
        pressure_slips: Vec::new(),
        iterations: 0,
        residual: 0.0,
        solver_signature: "Unresolved".to_string(),
        solver_established: false,
        demand_scale_achieved: None,
    })
}

/// `POST /api/nova/compare` : compare deux nominations NoVa sur le réseau actif.
pub(super) async fn post_compare_nominations(
    State(state): State<SharedState>,
    Json(payload): Json<CompareNominationsRequest>,
) -> Result<Json<CompareNominationsResponse>, (StatusCode, Json<ApiError>)> {
    let dataset_id = active_dataset_id(&state);
    let network = active_network(&state);
    let gas = active_gas_composition(&state);
    let max_iter = payload.max_iter.unwrap_or(400);
    let tolerance = payload.tolerance.unwrap_or(1e-3);
    let robust = payload.robust_mode.unwrap_or(true);

    let a_id = payload.scenario_a_id.trim().to_string();
    let b_id = payload.scenario_b_id.trim().to_string();
    if a_id.is_empty() || b_id.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "scenario_a_id and scenario_b_id must not be empty",
        ));
    }

    let xml_a = super::resolve_scenario_xml(&state, &dataset_id, &a_id).ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            format!(
                "scénario {} introuvable pour le dataset {}",
                a_id, dataset_id
            ),
        )
    })?;
    let xml_b = super::resolve_scenario_xml(&state, &dataset_id, &b_id).ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            format!(
                "scénario {} introuvable pour le dataset {}",
                b_id, dataset_id
            ),
        )
    })?;

    let network_for_solve = (*network).clone();
    let pool = state.rayon_pool.clone();
    let permit = state
        .simulation_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "simulation capacity reached, retry later",
            )
        })?;

    let state_for_mode = state.clone();
    let join = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        pool.install(|| {
            sync_compressor_map_mode_for_solve(&state_for_mode);
            let mut scenario_a = crate::gaslib::parse_scenario_demands_from_str(&xml_a)
                .map_err(|err| format!("{err:#}"))?;
            crate::gaslib::enrich_scenario_with_balance_hub(&network_for_solve, &mut scenario_a);
            let mut scenario_b = crate::gaslib::parse_scenario_demands_from_str(&xml_b)
                .map_err(|err| format!("{err:#}"))?;
            crate::gaslib::enrich_scenario_with_balance_hub(&network_for_solve, &mut scenario_b);

            let mut outcome_a =
                run_nova_solve_for_compare(&network_for_solve, &scenario_a, gas, max_iter, tolerance, robust)?;
            outcome_a.scenario_id = a_id;
            let mut outcome_b =
                run_nova_solve_for_compare(&network_for_solve, &scenario_b, gas, max_iter, tolerance, robust)?;
            outcome_b.scenario_id = b_id;
            Ok::<_, String>((outcome_a, outcome_b))
        })
    })
    .await
    .map_err(|err| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join: {err}")))?;

    let (outcome_a, outcome_b) = join
        .map_err(|err| api_error(StatusCode::UNPROCESSABLE_ENTITY, err))?;

    // Deltas.
    let mut delta_pressures = HashMap::new();
    let all_p: std::collections::HashSet<String> = outcome_a
        .pressures
        .keys()
        .chain(outcome_b.pressures.keys())
        .cloned()
        .collect();
    let mut max_abs_delta_p = 0.0_f64;
    for id in &all_p {
        let pa = outcome_a.pressures.get(id).copied().unwrap_or(0.0);
        let pb = outcome_b.pressures.get(id).copied().unwrap_or(0.0);
        let d = pb - pa;
        max_abs_delta_p = max_abs_delta_p.max(d.abs());
        delta_pressures.insert(id.clone(), d);
    }

    let mut delta_flows = HashMap::new();
    let all_q: std::collections::HashSet<String> = outcome_a
        .flows
        .keys()
        .chain(outcome_b.flows.keys())
        .cloned()
        .collect();
    let mut max_abs_delta_q = 0.0_f64;
    for id in &all_q {
        let qa = outcome_a.flows.get(id).copied().unwrap_or(0.0);
        let qb = outcome_b.flows.get(id).copied().unwrap_or(0.0);
        let d = qb - qa;
        max_abs_delta_q = max_abs_delta_q.max(d.abs());
        delta_flows.insert(id.clone(), d);
    }

    let set_a: std::collections::HashSet<&str> =
        outcome_a.deficit_sinks.iter().map(|s| s.as_str()).collect();
    let shared: Vec<String> = outcome_b
        .deficit_sinks
        .iter()
        .filter(|s| set_a.contains(s.as_str()))
        .cloned()
        .collect();

    Ok(Json(CompareNominationsResponse {
        scenario_a_id: outcome_a.scenario_id.clone(),
        scenario_b_id: outcome_b.scenario_id.clone(),
        outcome_a,
        outcome_b,
        delta_pressures,
        delta_flows,
        shared_deficit_sinks: shared,
        max_abs_delta_p_bar: max_abs_delta_p,
        max_abs_delta_q_m3s: max_abs_delta_q,
        nodes_compared: all_p.len(),
        pipes_compared: all_q.len(),
    }))
}

/// `POST /api/nova/validate` : verdict NoVa compact (sans cartes P/Q) pour un agent HTTP.
pub(super) async fn post_nova_validate(
    State(state): State<SharedState>,
    Json(payload): Json<ValidateNominationRequest>,
) -> Result<Json<NovaValidateResponse>, (StatusCode, Json<ApiError>)> {
    if payload.scenario_id.trim().is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "scenario_id must not be empty",
        ));
    }
    if let Some(demands) = payload.demands.as_ref() {
        if demands_have_non_finite(demands) {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "demands must be finite numbers (explicit 0 is a shut-off)",
            ));
        }
    }

    let scenario_id = payload.scenario_id.trim().to_string();
    let dataset_id = active_dataset_id(&state);
    let _xml = super::resolve_scenario_xml(&state, &dataset_id, &scenario_id).ok_or_else(
        || {
            api_error(
                StatusCode::NOT_FOUND,
                format!(
                    "scénario {} introuvable pour le dataset {}",
                    scenario_id, dataset_id
                ),
            )
        },
    )?;

    let network = active_network(&state);
    let gas = active_gas_composition(&state);
    let max_iter = payload.max_iter.unwrap_or(400);
    let tolerance = payload.tolerance.unwrap_or(1e-3);
    let robust = payload.robust_mode.unwrap_or(true);
    let applied_overrides = payload.demands.clone().unwrap_or_default();

    let (demands, scenario) = resolve_simulation_demands(
        &state,
        &network,
        Some(scenario_id.as_str()),
        payload.demands.as_ref(),
    )
    .map_err(|err| api_error(StatusCode::UNPROCESSABLE_ENTITY, err))?;
    let Some(scenario) = scenario else {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "scénario NoVa introuvable après résolution",
        ));
    };

    let permit = state
        .simulation_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "simulation capacity reached, retry later",
            )
        })?;

    let pool = state.rayon_pool.clone();
    let state_for_mode = state.clone();
    let network_for_solve = (*network).clone();
    let join = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        pool.install(|| {
            sync_compressor_map_mode_for_solve(&state_for_mode);
            run_nova_solve_with_demands(
                &network_for_solve,
                &scenario,
                &demands,
                gas,
                max_iter,
                tolerance,
                robust,
            )
        })
    })
    .await
    .map_err(|err| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join: {err}")))?;

    let mut outcome = match join {
        Ok(outcome) => outcome,
        Err(err) => outcome_from_unconverged_solve(scenario_id.clone(), err)
            .map_err(|err| api_error(StatusCode::UNPROCESSABLE_ENTITY, err))?,
    };
    outcome.scenario_id = scenario_id.clone();

    Ok(Json(compact_validate_response(
        dataset_id,
        scenario_id,
        &outcome,
        applied_overrides,
        outcome.demand_scale_achieved,
        &outcome.solver_signature,
        outcome.solver_established,
    )))
}

fn collect_scenarios(base: &Path, dir: &Path, out: &mut Vec<NovaScenarioSummary>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_scenarios(base, &path, out);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("scn") {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let id = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let relative_path = path
            .strip_prefix(base)
            .ok()
            .and_then(|p| p.to_str())
            .unwrap_or(&filename)
            .to_string();
        out.push(NovaScenarioSummary {
            id,
            filename,
            relative_path,
            source: "bundled".to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch_dir() -> PathBuf {
        scratch_dir_for("common")
    }

    fn scratch_dir_for(suffix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gazflow-nova-test-{}-{suffix}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reduced_nomination_stem_strips_imported_prefix() {
        assert_eq!(
            reduced_nomination_stem("imported-custom-1234.scn"),
            "custom-1234"
        );
        assert_eq!(
            reduced_nomination_stem("nomination_mild_618"),
            "nomination_mild_618"
        );
        assert_eq!(
            reduced_nomination_stem("imported-imported-foo_reduit-1"),
            "foo_reduit-1"
        );
    }

    #[test]
    fn collect_scenarios_walks_subdirs() {
        let tmp = scratch_dir();
        std::fs::create_dir_all(tmp.join("Nominations-582")).unwrap();
        std::fs::write(
            tmp.join("Nominations-582").join("nomination_mild_618.scn"),
            "<scenario/>",
        )
        .unwrap();
        std::fs::write(tmp.join("GasLib-582.scn"), "<scenario/>").unwrap();
        std::fs::write(tmp.join("not-a-scenario.txt"), "x").unwrap();

        let mut out = Vec::new();
        collect_scenarios(&tmp, &tmp, &mut out);
        let ids: Vec<&str> = out.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"nomination_mild_618"));
        assert!(ids.contains(&"GasLib-582"));
        assert!(!ids.contains(&"not-a-scenario"));
        let mild = out.iter().find(|s| s.id == "nomination_mild_618").unwrap();
        assert!(mild.relative_path.contains("Nominations-582"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn post_nova_capacity_returns_404_for_unknown_scenario() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("http404");
        let mut net = crate::graph::GasNetwork::new();
        net.add_node(crate::graph::Node {
            id: "source".into(),
            x: 0.0,
            y: 0.0,
            lon: Some(10.0),
            lat: Some(50.0),
            height_m: 0.0,
            pressure_lower_bar: None,
            pressure_upper_bar: None,
            pressure_fixed_bar: Some(70.0),
            flow_min_m3s: None,
            flow_max_m3s: None,
        });
        let defaults: HashMap<String, f64> = HashMap::new();
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            net,
            defaults,
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        let body = serde_json::json!({ "scenario_id": "does_not_exist" });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/capacity")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn list_nova_scenarios_dedupes_by_id_across_subdirs() {
        use axum::body::Body;
        use axum::http::Request;
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("dedup");
        std::fs::create_dir_all(tmp.join("a")).unwrap();
        std::fs::create_dir_all(tmp.join("b")).unwrap();
        std::fs::write(tmp.join("a").join("dup.scn"), "<scenario/>").unwrap();
        std::fs::write(tmp.join("b").join("dup.scn"), "<scenario/>").unwrap();
        std::fs::write(tmp.join("unique.scn"), "<scenario/>").unwrap();

        let net = crate::graph::GasNetwork::new();
        let defaults: HashMap<String, f64> = HashMap::new();
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            net,
            defaults,
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        let req = Request::builder()
            .method("GET")
            .uri("/api/nova/scenarios")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let ids: Vec<&str> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids.iter().filter(|id| **id == "dup").count(), 1);
        assert!(ids.contains(&"unique"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    const VALID_SCN_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<boundaryValue xmlns="http://gaslib.zib.de/Gas" xmlns:framework="http://gaslib.zib.de/Framework">
  <scenario id="custom_imported">
    <node type="entry" id="entry01">
      <flow bound="lower" value="160.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="160.00" unit="1000m_cube_per_hour"/>
    </node>
    <node type="exit" id="exit01">
      <flow bound="lower" value="100.00" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="100.00" unit="1000m_cube_per_hour"/>
    </node>
  </scenario>
</boundaryValue>"#;

    #[tokio::test]
    async fn import_nomination_then_list_and_resolve() {
        use axum::body::{Body, to_bytes};
        use axum::http::{Request, StatusCode};
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("import");
        let net = crate::graph::GasNetwork::new();
        let defaults: HashMap<String, f64> = HashMap::new();
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            net,
            defaults,
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        // Import invalide : mauvaise extension → 400.
        let bad = serde_json::json!({ "filename": "notscn.txt", "xml": "<x/>" });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/nominations")
            .header("content-type", "application/json")
            .body(Body::from(bad.to_string()))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );

        // Import valide.
        let body = serde_json::json!({
            "filename": "custom_imported.scn",
            "xml": VALID_SCN_XML,
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/nominations")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let id = v["id"].as_str().unwrap().to_string();
        assert!(id.starts_with("imported-custom_imported-"));
        assert_eq!(v["source"].as_str(), Some("imported"));

        // La nomination importée doit apparaître dans la liste.
        let req = Request::builder()
            .method("GET")
            .uri("/api/nova/scenarios")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let listed: Vec<&str> = v.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
        assert!(listed.contains(&id.as_str()));

        // Suppression.
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/nova/nominations/{id}"))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn post_reduced_nomination_rejects_non_finite_demands() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("reduced-nan");
        let net = crate::graph::GasNetwork::new();
        let defaults: HashMap<String, f64> = HashMap::new();
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            net,
            defaults,
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        let body = r#"{"base_scenario_id":"any","reduced_demands":{"exit01":NaN}}"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/nominations/reduced")
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn reduced_nomination_import_then_list_and_delete() {
        use axum::body::{Body, to_bytes};
        use axum::http::{Request, StatusCode};
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("reduced");
        let net = crate::graph::GasNetwork::new();
        let defaults: HashMap<String, f64> = HashMap::new();
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            net,
            defaults,
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        // Import base nomination.
        let body = serde_json::json!({
            "filename": "custom_imported.scn",
            "xml": VALID_SCN_XML,
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/nominations")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let base_id = v["id"].as_str().unwrap().to_string();

        // Create reduced nomination from base.
        let reduced = serde_json::json!({
            "base_scenario_id": format!("  {base_id}  "),
            "reduced_demands": { "exit01": -20.0 },
            "filename": "nom_coupe",
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/nominations/reduced")
            .header("content-type", "application/json")
            .body(Body::from(reduced.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "reduced import failed");
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let reduced_id = v["id"].as_str().unwrap().to_string();
        assert!(reduced_id.contains("_reduit-"));
        assert_eq!(v["source"].as_str(), Some("imported"));
        assert_eq!(v["filename"].as_str(), Some("nom_coupe.scn"));

        // Listed in scenarios.
        let req = Request::builder()
            .method("GET")
            .uri("/api/nova/scenarios")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let listed: Vec<&str> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect();
        assert!(listed.contains(&reduced_id.as_str()));

        // Delete reduced nomination.
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/nova/nominations/{reduced_id}"))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Construit un micro-réseau source→sink et le charge comme dataset actif.
    fn micro_network() -> crate::graph::GasNetwork {
        use crate::graph::{ConnectionKind, EquipmentSpec, GasNetwork, Node, Pipe};
        let mut net = GasNetwork::new();
        net.add_node(Node {
            id: "entry01".into(),
            x: 0.0,
            y: 0.0,
            lon: Some(10.0),
            lat: Some(50.0),
            height_m: 0.0,
            pressure_lower_bar: None,
            pressure_upper_bar: None,
            pressure_fixed_bar: Some(70.0),
            flow_min_m3s: None,
            flow_max_m3s: None,
        });
        net.add_node(Node {
            id: "exit01".into(),
            x: 1.0,
            y: 0.0,
            lon: Some(11.0),
            lat: Some(50.0),
            height_m: 0.0,
            pressure_lower_bar: None,
            pressure_upper_bar: None,
            pressure_fixed_bar: None,
            flow_min_m3s: None,
            flow_max_m3s: None,
        });
        net.add_pipe(Pipe {
            id: "p1".into(),
            from: "entry01".into(),
            to: "exit01".into(),
            kind: ConnectionKind::Pipe,
            is_open: true,
            length_km: 5.0,
            diameter_mm: 500.0,
            roughness_mm: 0.05,
            compressor_ratio_max: None,
            flow_min_m3s: None,
            flow_max_m3s: None,
            equipment: EquipmentSpec::default(),
        });
        net
    }

    fn scn_xml(flow_value: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<boundaryValue xmlns="http://gaslib.zib.de/Gas" xmlns:framework="http://gaslib.zib.de/Framework">
  <scenario id="cmp">
    <node type="entry" id="entry01">
      <flow bound="lower" value="{flow_value}" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="{flow_value}" unit="1000m_cube_per_hour"/>
    </node>
    <node type="exit" id="exit01">
      <flow bound="lower" value="{flow_value}" unit="1000m_cube_per_hour"/>
      <flow bound="upper" value="{flow_value}" unit="1000m_cube_per_hour"/>
    </node>
  </scenario>
</boundaryValue>"#
        )
    }

    #[tokio::test]
    async fn compare_nominations_returns_two_outcomes_and_deltas() {
        use axum::body::{Body, to_bytes};
        use axum::http::Request;
        use axum::http::StatusCode;
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("cmp");
        let net = micro_network();
        let defaults: HashMap<String, f64> = HashMap::new();
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            net,
            defaults,
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        // Importe deux nominations avec débits différents.
        for (name, flow) in [("nom_low.scn", "50.00"), ("nom_high.scn", "160.00")] {
            let body = serde_json::json!({ "filename": name, "xml": scn_xml(flow) });
            let req = Request::builder()
                .method("POST")
                .uri("/api/nova/nominations")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK, "import {name} failed");
        }

        // Récupère les ids importés.
        let req = Request::builder()
            .method("GET")
            .uri("/api/nova/scenarios")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let v: serde_json::Value =
            serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
        let ids: Vec<String> = v.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap().to_string()).collect();
        let id_low = ids.iter().find(|i| i.contains("nom_low")).unwrap().clone();
        let id_high = ids.iter().find(|i| i.contains("nom_high")).unwrap().clone();

        let body = serde_json::json!({ "scenario_a_id": id_low, "scenario_b_id": id_high });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/compare")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let v: serde_json::Value =
            serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
        assert!(v["outcome_a"]["pressures"].is_object());
        assert!(v["outcome_b"]["flows"].is_object());
        assert!(v["delta_pressures"].is_object());
        assert!(v["max_abs_delta_p_bar"].is_number());
        assert_eq!(v["nodes_compared"].as_u64(), Some(2));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn compact_validate_response_omits_nodal_maps_and_flags_not_solved_local() {
        let outcome = NominationSolveOutcome {
            scenario_id: "nom".into(),
            feasible: false,
            cause: "NotSolvedLocal".into(),
            deficit_sinks: vec!["exit01".into()],
            pressures: HashMap::from([("entry01".into(), 70.0), ("exit01".into(), 40.0)]),
            flows: HashMap::from([("p1".into(), 10.0)]),
            pressure_slips: vec![
                crate::solver::ScenarioPressureSlip {
                    node_id: "exit01".into(),
                    solved_pressure_bar: 40.0,
                    lower_bar: Some(50.0),
                    upper_bar: None,
                    shortfall_bar: 10.0,
                    excess_bar: 0.0,
                    from_scenario_envelope: true,
                    shortpipe_partner_id: None,
                },
                crate::solver::ScenarioPressureSlip {
                    node_id: "exit02".into(),
                    solved_pressure_bar: 48.0,
                    lower_bar: Some(50.0),
                    upper_bar: None,
                    shortfall_bar: 2.0,
                    excess_bar: 0.0,
                    from_scenario_envelope: true,
                    shortpipe_partner_id: None,
                },
            ],
            iterations: 12,
            residual: 1.0,
            solver_signature: "Unresolved".into(),
            solver_established: false,
            demand_scale_achieved: None,
        };
        let json = serde_json::to_value(compact_validate_response(
            "GasLib-11".into(),
            "nom".into(),
            &outcome,
            HashMap::from([("exit01".into(), 0.0)]),
            None,
            &outcome.solver_signature,
            outcome.solver_established,
        ))
        .unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["feasible"], false);
        assert_eq!(json["cause"], "NotSolvedLocal");
        assert_eq!(json["network_id"], "GasLib-11");
        assert_eq!(json["nomination_id"], "nom");
        assert_eq!(json["applied_overrides"]["exit01"], 0.0);
        assert_eq!(json["worst_sink"], "exit01");
        assert_eq!(json["worst_shortfall_bar"], 10.0);
        assert!(json["pressures"].is_null());
        assert!(json["flows"].is_null());
        assert!(json["limitations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item.as_str().unwrap().contains("infaisabilité")));
    }

    #[tokio::test]
    async fn post_nova_validate_returns_404_for_unknown_scenario() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("validate404");
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            micro_network(),
            HashMap::new(),
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        let body = serde_json::json!({ "scenario_id": "does_not_exist" });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/validate")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn post_nova_validate_rejects_empty_id_and_non_finite_demands() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("validate400");
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            micro_network(),
            HashMap::new(),
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        let empty = serde_json::json!({ "scenario_id": "  " });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/validate")
            .header("content-type", "application/json")
            .body(Body::from(empty.to_string()))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );

        let nan = r#"{"scenario_id":"any","demands":{"exit01":NaN}}"#;
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/validate")
            .header("content-type", "application/json")
            .body(Body::from(nan))
            .unwrap();
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn post_nova_validate_returns_compact_verdict_and_keeps_explicit_zero() {
        use axum::body::{Body, to_bytes};
        use axum::http::{Request, StatusCode};
        use std::collections::HashMap;
        use tower::ServiceExt;

        let tmp = scratch_dir_for("validate-ok");
        let app = crate::api::create_router_with_runtime_limits_and_datasets(
            micro_network(),
            HashMap::new(),
            "test".to_string(),
            vec!["test".to_string()],
            tmp.clone(),
            2,
            1,
        );

        let body = serde_json::json!({
            "filename": "nom_validate.scn",
            "xml": scn_xml("50.00"),
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/nominations")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let imported: serde_json::Value =
            serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let nomination_id = imported["id"].as_str().unwrap().to_string();

        let body = serde_json::json!({
            "scenario_id": format!("  {nomination_id}  "),
            "demands": { "exit01": 0.0 },
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/nova/validate")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let v: serde_json::Value =
            serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
        assert_eq!(status, StatusCode::OK, "validate failed: {v}");
        assert_eq!(v["ok"], true);
        assert_eq!(v["nomination_id"], nomination_id);
        assert!(v["cause"].is_string());
        assert!(v["solver_signature"].is_string());
        assert!(v["min_pressure_bar"].is_number());
        assert!(v["max_pressure_bar"].is_number());
        assert!(v["deficit_details"].is_array());
        assert!(v["limitations"].as_array().unwrap().len() >= 2);
        assert_eq!(v["applied_overrides"]["exit01"], 0.0);
        assert!(v.get("pressures").is_none());
        assert!(v.get("flows").is_none());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
