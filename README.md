# Junction Starter

This workspace contains a basic Vite + React frontend (`frontend/`) and a Node + Express backend (`backend/`).

Quick commands:

Frontend:
- cd frontend
- npm install
- npm run dev

Backend:
- cd backend
- npm install
- npm run dev

One-command dev (recommended):

From the repository root you can start both servers together:

```bash
npm install
npm run dev
```

This runs both the backend (`backend`) and the frontend dev server (`frontend`) concurrently. The Vite dev server proxies `/api` to the backend running on port 4000.

Notes:
- If you run into peer dependency issues when installing the frontend, run `npm install --legacy-peer-deps` inside `frontend`.
- To stop the combined dev session, press Ctrl+C in the terminal where `npm run dev` is running.

Sharing with ngrok
------------------

If you want to share the running frontend with others, you can use ngrok. Install ngrok (Homebrew or from https://ngrok.com) and set your auth token.

From the repo root run:

```bash
npm run share
```

This runs the backend, frontend, and starts `ngrok` to expose the frontend port (5173). Note: if port 5173 is in use, ngrok will forward whichever port the Vite server uses — check the ngrok output for the public URL.

If you prefer to run ngrok yourself:

```bash
# start dev servers
npm run dev
# in a separate terminal
npx ngrok http 5173
```

