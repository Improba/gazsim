# Quickstart

Fastest way to run a GazFlow simulation locally.

## Prerequisites

- Docker
- Docker Compose

## 1) Fetch a dataset

```bash
./scripts/fetch_gaslib.sh GasLib-11
```

## 2) Start the environment

```bash
./scripts/dev.sh
```

## 3) Open the application

- Frontend: `http://localhost:9000`
- Backend API: `http://localhost:3001`

The app opens on **Tableau de bord** (`/`), titled **Étude**. The other study entry is **Tenue pression** (`/map`). N-1, SCADA calibration, Transient, Workspace, Import, Exports, and Batch are under **Outils**.

## 4) Validate a nomination (NoVa)

1. On the dashboard or on an empty map, click **Démo nomination** (or load a network and pick a `.scn`).
2. The demo loads **GasLib-11**, imports **Nomination du jour** and **Nomination de pointe** (same flows; pointe has a tighter pressure bound on `exit01`), selects pointe, and runs **Valider la nomination**.
3. You land on the map: colour by contract margin, cause on the delivery point that misses its bound.
4. **StudyNextSteps** (equal weight): validate the other nomination (jour should hold), optional N-1 on this nomination, or export the study dossier.
5. Advanced solver logs stay collapsed. JSON/CSV/ZIP export remains available after convergence.

Deep link: `?run=<run_id>` hydrates a previous NoVa run (Workproba / shared run).

## 5) Optional — transient simulation

1. Open **Transitoire** (`/transient`) from the **Outils** menu.
2. Choose **PDE** mode (trees/cycles supported; GasLib-11 works). Prefer `dt_s ≈ 60` with **adaptive dt** for multi-hour runs.
3. Set duration and time step, then run. Use the player to inspect pressures, flows, and `flows_in` / `flows_out` per step.

Transient results are not included in the steady-state ZIP export v1.

## Stop

```bash
./scripts/stop.sh
```
