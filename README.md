# Real agent backend setup

The GitHub Pages site is static; the API must run on a separate server. The backend calls an OpenAI-compatible chat-completions API (including compatible Groq and Gemini endpoints). It coordinates six role-specific agents: CEO, CODER, DB, DEVOPS, QA, and DEPLOY. Calls are made to the configured model provider; the backend does not execute shell commands, modify repositories, or deploy applications.

## Configure the AI provider

1. On the server, copy `backend/.env.example` to `backend/.env`.
2. Set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` using the provider's current API documentation. Groq's compatible base URL is `https://api.groq.com/openai/v1`; Gemini's OpenAI-compatible base URL is `https://generativelanguage.googleapis.com/v1beta/openai`. Choose a model enabled for your account. Keep the key only in the server `.env`; never commit it or put it in browser JavaScript.
3. Set `ALLOWED_ORIGINS` to the exact deployed website origin(s), comma-separated. For a GitHub Pages project site the origin is `https://al-business.github.io`.
4. Configure the site's `config.js` with the backend public HTTPS URL (no trailing slash).

## Run with Docker Compose (recommended)

From the repository root on a Linux server with Docker Compose installed:

```sh
cp backend/.env.example backend/.env
# Edit backend/.env and set provider credentials, model, and ALLOWED_ORIGINS.
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/health
```

The API port binds to localhost. Put it behind a TLS reverse proxy (for example Caddy or Nginx) and expose only HTTPS publicly. The Compose service restarts unless stopped and has a health check.

## Run with PM2 instead

Install Node.js 20+ and PM2 on the server. Create and configure `backend/.env` as above, then from the repository root:

```sh
cd backend && npm install --omit=dev && cd ..
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup` with the appropriate server privileges, then `pm2 save`. Place the API behind a TLS reverse proxy and firewall the direct Node port as appropriate. Use either PM2 or Docker Compose, not both for the same process.

## API

- `GET /health` — process health check.
- `GET /api/health` — API health/configuration status.
- `POST /api/chat` — JSON `{ "message": "..." }`; returns `{ "reply": "...", "agents": [{ "name": "CEO", "role": "...", "reply": "..." }] }`.
- `POST /api/agents/run` — same multi-agent workflow endpoint.

The browser posts to `${window.AL_BUSINESS_API_URL}/api/chat`. If backend URL is unset or the API is unavailable, the UI displays an error; it never fabricates a demo answer. Configure HTTPS and CORS before exposing the API. Add authentication before making this public for production use; the included IP-based rate limit is a basic safeguard, not complete abuse protection.
