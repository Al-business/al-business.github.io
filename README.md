# Real agent worker and recovery design

GitHub Pages hosts only the static website. Render hosts the Node.js API/worker and a managed PostgreSQL database for durable jobs. The six agents are model-driven roles. The worker starts work after a user submits a task; it is not an unsupervised system that invents tasks or executes commands/deployments.

## Render setup

1. In Render, choose **New → Blueprint**, connect `Al-business/al-business.github.io`, and select `main`. Render reads `render.yaml` and proposes a web service plus PostgreSQL database. The Blueprint uses paid plans for persistent uptime/storage; verify the current plan and pricing in Render before confirming.
2. In Render service environment, provide `AI_API_KEY` and `AI_MODEL`. `AI_BASE_URL` defaults to Groq's OpenAI-compatible endpoint. Never store provider secrets in GitHub or browser code.
3. Wait until deploy is healthy. The frontend is configured for `https://al-business-agent-api-albusiness.onrender.com`; if Render assigns another host, update `config.js` and commit it. The site origin must exactly match `ALLOWED_ORIGINS`.
4. Test `https://al-business-agent-api-albusiness.onrender.com/health` and submit a task in the site's workflow/chat UI.

## Durable task recovery

`POST /api/chat` or `POST /api/agents/run` stores a task in PostgreSQL and returns HTTP 202 with its job ID. The client polls `GET /api/agents/jobs/:id` for queued/running/completed/failed state. Worker leases expire if the process crashes; a restarted worker claims expired or queued tasks. Each agent response is checkpointed to PostgreSQL, so completed agent work is reused on retry. Provider transient errors use bounded exponential retries; whole jobs have a bounded attempt count and terminal failures remain visible in the API. Render restarts the web process; PostgreSQL keeps queued task state across restarts.

The system does not autonomously create tasks, execute shell commands, push code, or deploy user projects. Such tools require separate authorization, sandboxing, human approval, and audit controls. API authentication and stronger abuse protections should be added before public production use; CORS/rate limiting are not authentication.

## API

- `GET /health` — API and database health; Render health check.
- `GET /api/health` — worker state and queued task count.
- `POST /api/chat` — enqueue a task, returns `{ id, status, created_at }` (202).
- `POST /api/agents/run` — enqueue alias.
- `GET /api/agents/jobs/:id` — poll job status and checkpointed agent responses.

For local work, configure `backend/.env` from `.env.example`, create a PostgreSQL database, and run `cd backend && npm install && npm start`. `DATABASE_SSL=false` is for local PostgreSQL only.
