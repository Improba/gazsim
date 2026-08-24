//! Registre des runs NoVa (HTTP + WS) : compact pour Workproba, état complet pour l'UI.
//! Pas de cartes P/Q dans les réponses compactes.

use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Serialize;

use super::{ApiError, SharedState, active_dataset_id, store_last_simulation, try_activate_dataset};
use crate::solver::{
    BoundaryPressureSupplyReport, NovaVerdict, ScenarioPressureMargin, ScenarioPressureSlip,
    SinkDiagnostic, SolverResult,
};

const MAX_NOVA_RUNS: usize = 32;

#[derive(Debug, Clone)]
pub(crate) struct NovaRunRecord {
    pub run_id: String,
    pub dataset_id: String,
    pub scenario_id: Option<String>,
    pub kind: String,
    pub created_ms: u64,
    pub demands: HashMap<String, f64>,
    pub result: SolverResult,
    pub pressure_slips: Vec<ScenarioPressureSlip>,
    pub pressure_margins: Vec<ScenarioPressureMargin>,
    pub boundary_supply: Vec<BoundaryPressureSupplyReport>,
    pub sink_diagnostics: Vec<SinkDiagnostic>,
    pub nova_verdict: Option<NovaVerdict>,
}

impl NovaRunRecord {
    pub(crate) fn from_solve(
        run_id: impl Into<String>,
        dataset_id: impl Into<String>,
        scenario_id: Option<String>,
        kind: impl Into<String>,
        demands: HashMap<String, f64>,
        result: SolverResult,
        pressure_slips: Vec<ScenarioPressureSlip>,
        pressure_margins: Vec<ScenarioPressureMargin>,
        boundary_supply: Vec<BoundaryPressureSupplyReport>,
        sink_diagnostics: Vec<SinkDiagnostic>,
        nova_verdict: Option<NovaVerdict>,
    ) -> Self {
        Self {
            run_id: run_id.into(),
            dataset_id: dataset_id.into(),
            scenario_id,
            kind: kind.into(),
            created_ms: now_ms(),
            demands,
            result,
            pressure_slips,
            pressure_margins,
            boundary_supply,
            sink_diagnostics,
            nova_verdict,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct NovaRunStore {
    order: VecDeque<String>,
    runs: HashMap<String, NovaRunRecord>,
    seq: u64,
}

impl NovaRunStore {
    pub(crate) fn next_run_id(&mut self) -> String {
        self.seq = self.seq.saturating_add(1);
        format!("run-{}-{}", now_ms(), self.seq)
    }

    fn insert(&mut self, record: NovaRunRecord) {
        let id = record.run_id.clone();
        if self.runs.insert(id.clone(), record).is_none() {
            self.order.push_back(id.clone());
        }
        while self.order.len() > MAX_NOVA_RUNS {
            if let Some(old) = self.order.pop_front() {
                self.runs.remove(&old);
            }
        }
    }

    fn get(&self, id: &str) -> Option<&NovaRunRecord> {
        self.runs.get(id)
    }

    fn summaries(&self) -> Vec<NovaRunSummary> {
        self.order
            .iter()
            .rev()
            .filter_map(|id| self.runs.get(id).map(NovaRunSummary::from_record))
            .collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct NovaRunSummary {
    pub run_id: String,
    pub dataset_id: String,
    pub scenario_id: Option<String>,
    pub kind: String,
    pub created_ms: u64,
    pub feasible: Option<bool>,
    pub cause: Option<String>,
    pub solver_signature: Option<String>,
    pub solver_established: Option<bool>,
}

impl NovaRunSummary {
    fn from_record(record: &NovaRunRecord) -> Self {
        let (feasible, cause, signature, established) = match &record.nova_verdict {
            Some(v) => (
                Some(v.feasible),
                Some(format!("{:?}", v.cause)),
                Some(format!("{:?}", v.solver_signature)),
                Some(v.converged),
            ),
            None => (None, None, None, None),
        };
        Self {
            run_id: record.run_id.clone(),
            dataset_id: record.dataset_id.clone(),
            scenario_id: record.scenario_id.clone(),
            kind: record.kind.clone(),
            created_ms: record.created_ms,
            feasible,
            cause,
            solver_signature: signature,
            solver_established: established,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct NovaRunCompact {
    pub run_id: String,
    pub dataset_id: String,
    pub scenario_id: Option<String>,
    pub kind: String,
    pub feasible: Option<bool>,
    pub cause: Option<String>,
    pub deficit_sinks: Vec<String>,
    pub solver_signature: Option<String>,
    pub solver_established: Option<bool>,
    pub demand_scale_achieved: Option<f64>,
    pub min_pressure_bar: f64,
    pub max_pressure_bar: f64,
    pub worst_shortfall_bar: f64,
    pub worst_sink: Option<String>,
    pub deficit_details: Vec<CompactDeficit>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct CompactDeficit {
    pub node_id: String,
    pub solved_pressure_bar: f64,
    pub required_lower_bar: Option<f64>,
    pub shortfall_bar: f64,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct NovaRunState {
    pub run_id: String,
    pub dataset_id: String,
    pub scenario_id: Option<String>,
    pub kind: String,
    pub demands: HashMap<String, f64>,
    pub pressures: HashMap<String, f64>,
    pub flows: HashMap<String, f64>,
    pub iterations: usize,
    pub residual: f64,
    pub warnings: Vec<String>,
    pub demand_scale_achieved: Option<f64>,
    pub pressure_slips: Vec<ScenarioPressureSlip>,
    pub pressure_margins: Vec<ScenarioPressureMargin>,
    pub boundary_supply: Vec<BoundaryPressureSupplyReport>,
    pub sink_diagnostics: Vec<SinkDiagnostic>,
    pub nova_verdict: Option<NovaVerdict>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn api_error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            error: message.into(),
        }),
    )
}

fn compact_from_record(record: &NovaRunRecord) -> NovaRunCompact {
    let mut min_p = f64::INFINITY;
    let mut max_p = f64::NEG_INFINITY;
    for pressure in record.result.pressures.values() {
        if pressure.is_finite() && *pressure > 0.0 {
            min_p = min_p.min(*pressure);
            max_p = max_p.max(*pressure);
        }
    }
    if !min_p.is_finite() {
        min_p = 0.0;
        max_p = 0.0;
    }

    let mut deficit_details: Vec<CompactDeficit> = record
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

    let (feasible, cause, signature, established, scale, deficit_sinks) =
        match &record.nova_verdict {
            Some(v) => (
                Some(v.feasible),
                Some(format!("{:?}", v.cause)),
                Some(format!("{:?}", v.solver_signature)),
                Some(v.converged),
                v.demand_scale_achieved,
                v.deficit_sinks.clone(),
            ),
            None => (None, None, None, None, None, Vec::new()),
        };

    let mut limitations = vec![
        "GazFlow est un outil d'étude comparative, non certifié.".to_string(),
        "NotSolvedLocal ne prouve pas l'infaisabilité physique.".to_string(),
    ];
    if cause.as_deref() == Some("NotSolvedLocal") {
        limitations.push(
            "Le Newton local n'a pas établi de point de fonctionnement ; ne pas conclure à l'infaisabilité."
                .to_string(),
        );
    }
    if signature.as_deref() == Some("IpoptEscalation") {
        limitations.push("Point établi par IPOPT (modèle in-repo).".to_string());
    }

    NovaRunCompact {
        run_id: record.run_id.clone(),
        dataset_id: record.dataset_id.clone(),
        scenario_id: record.scenario_id.clone(),
        kind: record.kind.clone(),
        feasible,
        cause,
        deficit_sinks,
        solver_signature: signature,
        solver_established: established,
        demand_scale_achieved: scale,
        min_pressure_bar: min_p,
        max_pressure_bar: max_p,
        worst_shortfall_bar,
        worst_sink,
        deficit_details,
        limitations,
    }
}

fn state_from_record(record: &NovaRunRecord) -> NovaRunState {
    NovaRunState {
        run_id: record.run_id.clone(),
        dataset_id: record.dataset_id.clone(),
        scenario_id: record.scenario_id.clone(),
        kind: record.kind.clone(),
        demands: record.demands.clone(),
        pressures: record.result.pressures.clone(),
        flows: record.result.flows.clone(),
        iterations: record.result.iterations,
        residual: record.result.residual,
        warnings: record.result.warnings.clone(),
        demand_scale_achieved: record.result.demand_scale_achieved,
        pressure_slips: record.pressure_slips.clone(),
        pressure_margins: record.pressure_margins.clone(),
        boundary_supply: record.boundary_supply.clone(),
        sink_diagnostics: record.sink_diagnostics.clone(),
        nova_verdict: record.nova_verdict.clone(),
    }
}

fn with_store_read<T>(state: &SharedState, f: impl FnOnce(&NovaRunStore) -> T) -> T {
    let guard = state
        .nova_runs
        .read()
        .expect("nova runs lock should not be poisoned");
    f(&guard)
}

pub(crate) fn store_nova_run(state: &SharedState, record: NovaRunRecord) {
    let mut guard = state
        .nova_runs
        .write()
        .expect("nova runs lock should not be poisoned");
    guard.insert(record);
}

pub(crate) fn allocate_run_id(state: &SharedState) -> String {
    let mut guard = state
        .nova_runs
        .write()
        .expect("nova runs lock should not be poisoned");
    guard.next_run_id()
}

fn require_run(
    state: &SharedState,
    id: &str,
) -> Result<NovaRunRecord, (StatusCode, Json<ApiError>)> {
    with_store_read(state, |store| store.get(id).cloned()).ok_or_else(|| {
        api_error(StatusCode::NOT_FOUND, format!("run introuvable: {id}"))
    })
}

pub(super) async fn list_nova_runs(
    State(state): State<SharedState>,
) -> Json<Vec<NovaRunSummary>> {
    Json(with_store_read(&state, |store| store.summaries()))
}

pub(super) async fn get_nova_run(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<NovaRunCompact>, (StatusCode, Json<ApiError>)> {
    let record = require_run(&state, &id)?;
    Ok(Json(compact_from_record(&record)))
}

pub(super) async fn get_nova_run_state(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<NovaRunState>, (StatusCode, Json<ApiError>)> {
    let record = require_run(&state, &id)?;
    Ok(Json(state_from_record(&record)))
}

pub(super) async fn post_apply_nova_run(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<NovaRunState>, (StatusCode, Json<ApiError>)> {
    let record = require_run(&state, &id)?;
    if record.dataset_id != active_dataset_id(&state) {
        try_activate_dataset(&state, &record.dataset_id)?;
    }
    store_last_simulation(&state, record.demands.clone(), record.result.clone());
    Ok(Json(state_from_record(&record)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::NovaCause;
    use crate::solver::NovaSolverSignature;

    fn sample_record() -> NovaRunRecord {
        NovaRunRecord::from_solve(
            "run-1",
            "GasLib-11",
            Some("nom".into()),
            "validate",
            HashMap::from([("exit01".into(), -1.0)]),
            SolverResult::from_core(
                HashMap::from([("entry01".into(), 70.0), ("exit01".into(), 40.0)]),
                HashMap::from([("p1".into(), 10.0)]),
                12,
                1e-4,
            ),
            vec![ScenarioPressureSlip {
                node_id: "exit01".into(),
                solved_pressure_bar: 40.0,
                lower_bar: Some(50.0),
                upper_bar: None,
                shortfall_bar: 10.0,
                excess_bar: 0.0,
                from_scenario_envelope: true,
                shortpipe_partner_id: None,
            }],
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Some(NovaVerdict {
                feasible: false,
                deficit_sinks: vec!["exit01".into()],
                cause: NovaCause::PressureDeficit,
                converged: true,
                demand_scale_achieved: Some(1.0),
                residual_m3s: 1e-4,
                iterations: 12,
                solver_signature: NovaSolverSignature::NewtonPosthoc,
            }),
        )
    }

    #[test]
    fn compact_omits_nodal_maps() {
        let compact = compact_from_record(&sample_record());
        let json = serde_json::to_value(&compact).unwrap();
        assert!(json.get("pressures").is_none());
        assert!(json.get("flows").is_none());
        assert_eq!(json["run_id"], "run-1");
        assert_eq!(json["dataset_id"], "GasLib-11");
        assert_eq!(json["worst_sink"], "exit01");
        assert_eq!(json["worst_shortfall_bar"], 10.0);
        assert_eq!(json["feasible"], false);
    }

    #[test]
    fn store_evicts_oldest_above_cap() {
        let mut store = NovaRunStore::default();
        for i in 0..(MAX_NOVA_RUNS + 3) {
            let mut rec = sample_record();
            rec.run_id = format!("run-{i}");
            store.insert(rec);
        }
        assert_eq!(store.runs.len(), MAX_NOVA_RUNS);
        assert!(store.get("run-0").is_none());
        assert!(store.get(&format!("run-{}", MAX_NOVA_RUNS + 2)).is_some());
    }

    #[test]
    fn next_run_id_is_unique() {
        let mut store = NovaRunStore::default();
        let a = store.next_run_id();
        let b = store.next_run_id();
        assert_ne!(a, b);
        assert!(a.starts_with("run-"));
    }
}
