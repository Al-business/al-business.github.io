# Al Business Coding Agent MVP

This MVP has a chat mode and a project-file generation mode. It asks a configured AI provider for a small project, validates the returned relative paths/extensions and size, then presents individual files for download. It does **not** write generated files to the server, execute shell commands, install packages, run tests, push commits, or deploy projects.

## Run locally

1. Install Node.js 20+ and a local AI-compatible provider key.
2. In `backend`, copy `.env.example` to `.env` and set `AI_API_KEY` and `AI_MODEL`.
3. Run `npm install && npm start` in `backend`.
4. Open the GitHub Pages site or serve the root folder locally. For local work, change `config.js` API URL to `http://localhost:3000`.

## Render deployment

The API URL configured in `config.js` expects the Render web service URL `https://al-business-agent-api-albusiness.onrender.com`. Confirm that this is the actual Render service URL; if it differs, update `config.js`. Set `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, and `ALLOWED_ORIGINS` in Render environment settings. The browser must use the exact site origin in `ALLOWED_ORIGINS`.

Check `GET /health` and `GET /api/health`. A working API still requires a valid AI provider key and model for project generation. Never place provider keys in frontend files.

## Endpoints

- `GET /health`
- `GET /api/health`
- `POST /api/chat` or `/api/agents/run`: enqueue agent discussion task
- `GET /api/agents/jobs/:id`: poll in-memory task status
- `POST /api/agent/build`: generate up to 8 allowlisted text files

The MVP job queue is in memory and is lost on backend restart. Generated code is not executed. Review generated files before use. CORS/rate limiting are not user authentication; add authentication and durable storage before public production use.
