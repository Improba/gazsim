# GazFlow

Natural gas network flow simulator, inspired by SIMONE.

## Visual overview

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/assets/map-3d-results.png" alt="GazFlow Tenue pression: 3D map coloured by contract margin" />
    </td>
    <td align="center" width="50%">
      <img src="docs/assets/workspace-schematic.png" alt="GazFlow analysis workspace: 2D nodal schematic with load colours" />
    </td>
  </tr>
  <tr>
    <td align="center"><em>Tenue pression (map)</em></td>
    <td align="center"><em>Workspace: 2D schematic</em></td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/assets/workspace-pressure-profile.png" alt="GazFlow analysis workspace: pressure profile along a path" />
    </td>
  </tr>
  <tr>
    <td align="center"><em>Workspace: pressure profile</em></td>
  </tr>
</table>

## Interface: study-first

The UI is organised around a **pressure-holding study** (tenue pression / NoVa), not an operational KPI dashboard.

- **Tableau de bord** (`/`) is the study landing (page title **Étude**). With no network: **Démo nomination** or load a network. After a NoVa run: verdict card and a link to the map. Optional alert center and recent networks. There are no KPI cards.
- **Tenue pression** (`/map`) is the primary study surface: Cesium 3D map coloured by **contract margin**, `SimulationPanel` (nomination, validate, compact cause, capacity, export), and `MapCauseCard` on a selected delivery point. An empty map stays on `/map` (it does not redirect).
- **Study context bar** (under the header, every page): trail `network → nomination → holding [→ N-1]` plus the study question. It replaces the former global status bar.
- **Navigation**: two study entries (Tableau de bord, Tenue pression). N-1, SCADA calibration, Transient, Workspace, Import, Exports, and Batch live under **Outils**.
- **Espace d'analyse** (`/workspace`, under Outils): 2D nodal schematic, pressure profile, or results table, next to a results rail that shares the same validation chain as the map.

After a current NoVa verdict, **StudyNextSteps** proposes three equal-weight follow-ups: validate the other nomination, run N-1 on this one, or export the study dossier. The old NoVa stepper (Verdict → Causes → Capacity → Export) is not mounted.

### Built-in demo (GasLib-11)

**Démo nomination** (dashboard, map empty state, or study panels) loads **GasLib-11** and two Improba `.scn` files generated in the session (not files from the GasLib archive):

| Nomination | Entry/exit flows | `exit01` pressure bound | Expected |
| --- | --- | --- | --- |
| Nomination du jour | identical | 20–70 barg | Holds |
| Nomination de pointe | identical | 68–72 barg | Deficit after line drop |

The demo selects **pointe** and runs validation, then opens the map. Do not describe pointe as “higher demand”: only the contractual pressure bound changes.

## What GazFlow does (business vision)

GazFlow simulates gas flow in transport and distribution networks. Beyond the original GasLib steady-state workflow, it supports **real network import**, **multi-component gas**, **regulation equipment**, **hourly demand scenarios**, **N-1 contingency analysis**, **SCADA calibration**, **topological editing with scenario compare**, and a **transient** mode (quasi-steady or 1D PDE MVP on simple topologies).

The tool computes hydraulic operating points (nodal pressures, pipe flows in Nm³/s), presents them on a **Cesium 3D map**, streams progress over **WebSocket**, and exports results (JSON/CSV/XLSX/ZIP). Optional **min/max flow bounds** per node support **check** and **optimize** capacity workflows.

### Use cases

- Study hydraulic behaviour under different withdrawal/injection levels and gas compositions (G20, H₂ blends with auto PR-78 above 20 % H₂)
- **Validate transport nominations (NoVa)**: Tenue pression (`/map`) and Workspace share one chain (verdict, deficit causes, per-sink capacity, reduce and re-validate, save reduced `.scn`, N-1 on the last validated nomination, study dossier). HTTP `POST /api/nova/validate` returns a compact verdict plus `run_id` (no nodal P/Q maps). Workproba and the map can share that run (`GET /api/nova/runs/{id}`, `?run=`). The built-in **Démo nomination** (GasLib-11, jour / pointe) is the short path for a first look.
- Import a network from **GeoJSON, CSV + YAML mapping, or Shapefile** and run operational scenarios
- **24 h timeseries** with thermosensitive demand profiles, weather CSV, weekday/weekend curves
- **N-1 security analysis** with parallel contingency runs, map overlay, Excel/CSV export
- **Calibrate** roughness (and limited demand scale) against SCADA pressure/flow measurements
- Save **topological variants** as scenarios and **compare** ΔP/ΔQ between variants
- Explore **transient** response on simple topologies: **quasi-steady** or **1D PDE** modes (`POST /api/simulate/transient`), **linepack** tracking, boundary mass balance via `flows_in` / `flows_out` (Qin/Qout per step), and the **TransientPlayer** UI (`/transient`)
- Document results via export history (`/exports` page)

### What the tool is not

GazFlow is a simulation and visualisation tool for **comparative studies**. It does not replace a certified network operation simulator or real-time SCADA.

### Capacity constraints (min / max flows)

The steady-state hydraulic core still solves for pressures and pipe flows from **nodal demands** (injections positive, withdrawals negative). On top of that, you can work with **flow bounds**:

- **From GasLib (`.net`)**: optional `flow_min` / `flow_max` on nodes and pipes are parsed into the graph. Node bounds appear on `GET /api/network` as `flow_min_m3s` / `flow_max_m3s`. Pipe bounds are kept on the backend and used whenever you run a capacity-aware solve.
- **From the client**: `POST /api/simulate` and the WebSocket `start_simulation` message accept optional `capacity_bounds` (`{ "nodeId": { "min", "max" } }`, m³/s) and optional `mode`:
  - **check** — Run the usual solve with your demands, then return `capacity_violations` where effective node net flows or pipe flows fall outside bounds.
  - **optimize** — Iterative **projection**: bounded free-node demands are clamped and the hydraulic solve is repeated; if a **slack** node (fixed pressure) would exceed its bounds, bounded free-node demands are adjusted proportionally until slack is feasible or an infeasibility / stagnation diagnostic is returned. The response includes **adjusted demands**, **active bounds**, and a simple squared-distance **objective** vs the target scenario.

This supports operational questions such as “does this nomination respect entry/exit-style envelopes?” and “what feasible demands are closest if the source is capped?”. It is **not** full market or contract optimisation (products, time slices, tariffs) unless you encode them yourself as static min/max.

For the algorithm and limitations in depth, see [Capacity constraints plan](docs/plans/capacity-constraints-plan.md).

## Architecture

- **back/** — Rust backend: computation engine (Darcy-Weisbach, Newton-Raphson) + REST API (Axum)
- **front/** — Vue 3 / QuasarJS / CesiumJS frontend: study-first UI (tenue pression on the map), analysis workspace, and 3D geospatial visualisation
- **docker/** — Dockerfiles for back and front services
- **docs/** — Documentation (architecture, science, plans)

## Prerequisites

- Docker & Docker Compose

That’s it. Rust and Node toolchains live inside the containers.

## Quickstart

```bash
# 1. Download GasLib data
./scripts/fetch_gaslib.sh GasLib-11

# 2. Start the development environment
./scripts/dev.sh
```

- Backend (Rust API): `http://localhost:3001`
- Frontend (Quasar/CesiumJS): `http://localhost:9000`

## Scripts


| Script                      | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `./scripts/dev.sh`          | Starts back + front via Docker Compose             |
| `./scripts/stop.sh`         | Stops all containers                               |
| `./scripts/back-shell.sh`   | Shell in the back container (`cargo add`, etc.)    |
| `./scripts/front-shell.sh`  | Shell in the front container (`npm install`, etc.) |
| `./scripts/back-test.sh`    | Runs `cargo test` in the container                 |
| `./scripts/front-test.sh`   | Runs `npm test` in the container                   |
| `./scripts/ci.sh`           | Full CI (build + back & front tests, including `--features nlp-ipopt`) |
| `./scripts/fetch_gaslib.sh` | Downloads GasLib data                              |
| `./scripts/validation-pack.sh` | Backend scientific protocol T1→T16 (see `docs/science/validation.md`) |


## Adding a dependency

Always use the container:

```bash
# Rust
./scripts/back-shell.sh
cargo add my-crate

# Node
./scripts/front-shell.sh
npm install my-package
```

The `Cargo.toml` and `package.json` files are on the shared volume: changes are visible on the host and versioned by git.

## Tests

```bash
./scripts/back-test.sh     # Rust tests (~420+ lib tests; recount via cargo)
./scripts/front-test.sh    # Frontend tests (see vitest)
./scripts/ci.sh            # Full CI (+ corpus verification step)
./scripts/validation-pack.sh  # Scientific protocol T1→T16
```

Current baseline (2026-08): **~458** Rust lib tests without `nlp-ipopt` (**~459** with the feature, recount via `cargo test --lib`); frontend: see vitest. Scientific thresholds and pack mapping: [validation](docs/science/validation.md). Execution details: [Testing](docs/testing/README.md).

Large transport networks (GasLib-582, GasLib-4197): optional smoke tests and env knobs are documented in [Testing](docs/testing/README.md). Model limits (compressor MVP, `.cdf` routing, convergence) are in [Limitations](docs/science/limitations.md). The Docker back image compiles with `--features nlp-ipopt` so IPOPT is the NoVa researcher when Newton does not establish a point (`GAZFLOW_NOVA_IPOPT_ESCALATION=off` to disable).

**GasLib-582 transport (Phase I, juin–juillet 2026)** : bench `nomination_mild_618.scn` via `compressor_diag`. Résidu **2,045 m³/s** avec nomination intacte (partial accept, cible 3×10⁻³). v18 (abandon Q sur boundaries) abaisse le résidu effectif à ~2,0 m³/s mais **viole la nomination** — voir `nomination_mass_balance` et `boundary_nomination_slips` dans le JSON diag. Détails : [bench 582](docs/testing/gaslib-582-compressor-bench.md), [diagnosis 582](docs/testing/gaslib-582-compressor-diagnosis.md).

## Licensing

GazFlow source code is published under the [GazFlow Public License v1.0](LICENSE):

- **Free** for individuals and academic non-commercial use
- **Commercial license required** for any enterprise or organization (companies, utilities, public bodies, contractors acting on their behalf)

See [LICENSING.md](LICENSING.md) and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md). Contact: `licensing@improba.fr`.

## Documentation

- [Quickstart](docs/quickstart.md)
- [Architecture](docs/architecture/overview.md)
- [Results export contract](docs/architecture/export-contract.md)
- [API stub (OpenAPI)](docs/contracts/openapi-stub.yaml)
- [Science (index)](docs/science/README.md)
- [Physical equations](docs/science/equations.md)
- [Model limitations](docs/science/limitations.md)
- [Testing & validation](docs/testing/README.md)
- [Scientific validation protocol](docs/science/validation.md)
- [GasLib-582 compressor bench (Phase I)](docs/testing/gaslib-582-compressor-bench.md)
- [Operational roadmap P6–P13](docs/plans/operational-roadmap.md)
- [Completion plan](docs/plans/completion-plan.md)
- [Production sprint plan](docs/plans/production-sprint-plan.md)
- [Capacity constraints plan](docs/plans/capacity-constraints-plan.md)
- [Test corpus](docs/testing/corpus/README.md)
- [Implementation plan (shared)](docs/plans/implementation-plan.md)
- [MVP features](docs/features/mvp.md)
- [NoVa persona (Camille)](docs/personas/ingenieur-natran.md)
- [NoVa interface plan](docs/temp/plan-interface-natran-nova.md) (§19 = study-first / démo sept. 2026)

