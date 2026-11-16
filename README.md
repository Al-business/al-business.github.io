# Al Business multi-agent backend

The GitHub Pages site is static; this API must run on a separate server. The backend makes real model API calls and coordinates six role-specific agents: CEO, CODER, DB, DEVOPS, QA, and DEPLOY. It does not execute shell commands, modify repositories, or deploy applications.

## Configure a model provider

1. On the server, copy `backend/.env.example` to `backend/.env`.
2. Set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` using the provider's current API documentation. The sample base URLs support Groq (`https://api.groq.com/openai/v1`) and Gemini's OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`). Choose one provider and a model available to your account.
3. Set `ALLOWED_ORIGINS` to the exact deployed website origin, for example `https://al-business.github.io`.
4. Set `window.AL_BUSINESS_API_URL` in the root `config.js` to the backend's public HTTPS base URL, without a trailing slash.
5. Never put the provider key in `config.js`, browser code, or a committed file. Store it only in the server's ignored `backend/.env` file or a secrets manager.

## Docker Compose (recommended)

From the repository root on a Linux server with Docker Compose installed:

```sh
cp backend/.env.example backend/.env
# Edit backend/.env with the provider key, model, and allowed website origin.
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/health
```

The API port binds to localhost. Put it behind a TLS reverse proxy and expose it publicly over HTTPS. Compose restarts the service unless stopped and checks its health.

## PM2 alternative

Install Node.js 20+ and PM2 on the server. Create and configure `backend/.env`, then run from the repository root:

```sh
cd backend && npm install --omit=dev && cd ..
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup` with the appropriate server privileges, then run `pm2 save`. Put the API behind a TLS reverse proxy. Use either PM2 or Docker Compose, not both for the same service.

## API

- `GET /health` — process health check.
- `GET /api/health` — API configuration status.
- `POST /api/chat` — JSON `{ "message": "..." }`; returns the combined reply and individual agent responses.
- `POST /api/agents/run` — alias for the same six-agent workflow.

The website sends requests to `${window.AL_BUSINESS_API_URL}/api/chat`. If the URL, backend, or model credentials are not configured, the interface reports an error; it never invents a response. Configure HTTPS and CORS before exposing the API. Add user authentication before making this public for production; the included IP-based rate limit is only a basic safeguard.
