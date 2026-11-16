# Al Business Agent MVP

## Local development

1. `cd backend`
2. `npm install`
3. `npm run dev`
4. Open the website and press the workflow button.

The frontend loads `config.js`, which defaults to `http://localhost:3000`.

## Environment variables

Set the following in `backend/.env` if you want real AI responses:

```env
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=http://localhost:3000,https://al-business.github.io
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=replace_with_real_key
AI_MODEL=replace_with_model_name
AI_MAX_TOKENS=900
AI_TIMEOUT_MS=60000
```

Without those variables, the backend automatically falls back to a deterministic local response so the MVP still works in a local dev environment.

## API

- `GET /health`
- `GET /api/health`
- `POST /api/agents/run` with `{ "message": "..." }`
- `GET /api/agents/jobs/:id`

This MVP is intentionally simple and safe: it queues tasks, runs them in-process, and reports status without executing arbitrary shell commands or writing files to the host filesystem.
