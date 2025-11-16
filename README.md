# WattForge (Junction)

_For judging purposes, the required .csv output files are in the **output** folder_

A full-stack demo for energy forecasting and AI-assisted analysis. Upload your historical workbook, generate synthetic forecasts (hourly and monthly), and optionally blend with Gemini-based hyper training. The UI is React + Vite + Tailwind; the backend is Node/Express.

## What the project does

- Upload an Excel workbook with three sheets:
  - `training_consumption`: hourly consumption by group (columns are group IDs)
  - `training_prices`: hourly electricity prices
  - `groups`: group metadata
- Parse and store data in-memory for quick iteration.
- Generate synthetic predictions:
  - Hourly 48h forecast (FWh) with diurnal shape, EV/night effects, and basic weather hooks.
  - Monthly 12-month forecast scaled by hours in month.
  - CSV exports that mirror the uploaded structure (semicolon-separated; decimal commas; headers without unit suffix).
- AI analysis & hyper-train (optional):
  - Ask natural-language questions and get pretty, direct answers.
  - Hyper-train sends compact samples to Gemini and returns per-group hourly/monthly forecasts (guardrailed and normalized), plus a simple aggregated series for quick viewing.

## Implemented enhancements

- Units & CSV
  - All energy values expressed in FortumWattHours (FWh).
  - CSV headers cleaned (no `(FWh)`), semicolon-separated, decimal comma formatting.
- Forecast shaping
  - Hourly values clamped to realistic ranges (baseline ~0–5 FWh).
  - Diurnal profile with evening peaks; mild seasonality for monthly.
  - EV penetration parameter increases evening load.
- Frontend UX
  - Hyper Forecast Summary card with quick stats and derived metrics.
  - Analysis answer style: structured vs direct (pretty bullets, human-readable).
  - Uploads accordion with previews and quick load.
  - Export buttons for hourly and monthly CSV.
- LLM guardrails
  - Strict prompt schema demanding 48 hourly and 12 monthly entries per group.
  - Tolerant parser accepting alternate key names and shapes; timestamp canonicalization.
  - Normalization and fallback synthesis when model output is incomplete.
  - Relaxed validation path that passes through model output and avoids 502s.

## Prerequisites

- macOS with zsh (default shell) or any modern Unix shell
- Node.js 18+
- npm 9+

## Setup

1. Install dependencies for backend and frontend:

```zsh
cd backend
npm install
cd ../frontend
npm install
```

2. Environment variables (for Gemini features):

```zsh
cd ../backend
cp .env.example .env
# Edit .env and set Gemini endpoint & credentials if you want LLM features
# e.g.
# GEMINI_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent
# GEMINI_API_KEY=your_key_here
# or provide GEMINI_ACCESS_TOKEN
```

## Running the project

Use two terminals or the root helper script.

- Backend (port 4000):

```zsh
cd backend
npm run dev
```

- Frontend (port 5173 by default):

```zsh
cd frontend
npm run dev
```

Alternatively from the repo root:

```zsh
npm install
npm run dev
```

Open the UI at the printed URL (typically http://localhost:5173/). The Vite dev server proxies `/api` to the backend.

## Basic workflow

1. Prepare a workbook with sheets: `training_consumption`, `training_prices`, `groups`.
2. Use the UI to upload the workbook (Upload training workbook section).
3. Load the dataset from the Past Uploads accordion.
4. (Optional) Click “Hyper Train (AI blend)” to request per-group forecasts via Gemini.
5. Generate and download CSVs (hourly/monthly) or view the 48h forecast chart.
6. Ask AI analysis questions in the Analysis section.

## API endpoints (backend)

- Upload & manage
  - POST `/api/upload-training` (form-data `file`)
  - GET `/api/uploads`, `/api/upload-preview`, `/api/load-upload`
- Synthetic forecasts
  - GET `/api/predict-csv?start=ISO` → returns both hourly and monthly CSV strings
  - GET `/api/predict-hourly.csv?start=ISO`
  - GET `/api/predict-monthly.csv?start=ISO`
- AI
  - POST `/api/analyze-training?format=text` or `/api/analyse-training?format=text` → human‑readable answer
  - POST `/api/hyper-train` → per-group hourly/monthly + aggregated series

## Troubleshooting

- Ports busy: change dev ports in frontend Vite config or backend.
- Missing sheets: ensure workbook has all three required sheets named exactly.
- Gemini errors: verify GEMINI_URL and GEMINI_API_KEY or access token.
- Model JSON drift: tolerant parsing and normalization are implemented; set `DEBUG_LLM=1` to inspect raw.

## Notes

- Data is in-memory; restart clears state.
- Forecasts are illustrative for demo purposes.

## License

MIT

