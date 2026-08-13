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

## 4) Validate a nomination (NoVa)

1. Open **Valider une nomination** (map) or the analysis workspace.
2. Select a `.scn` nomination, then click **Valider la nomination**.
3. Read the verdict, optional capacity study, reduce and re-validate, then export the certification report.
4. Advanced solver logs stay collapsed; JSON/CSV/ZIP export remains available after convergence.

## 5) Optional — transient simulation

1. Open **Transitoire** (`/transient`) from the task menu.
2. Choose **PDE** mode (trees/cycles supported; GasLib-11 works). Prefer `dt_s ≈ 60` with **adaptive dt** for multi-hour runs.
3. Set duration and time step, then run. Use the player to inspect pressures, flows, and `flows_in` / `flows_out` per step.

Transient results are not included in the steady-state ZIP export v1.

## Stop

```bash
./scripts/stop.sh
```
