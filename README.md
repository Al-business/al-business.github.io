# Al Business — Render deployment

The GitHub Pages frontend stays at `https://al-business.github.io`; Render runs the Node.js API separately. The API coordinates the six role-based model calls. It does not execute shell commands, modify GitHub repositories, or deploy user projects.

## Deploy the backend to Render

1. Sign in to Render and connect the GitHub account that has access to `Al-business/al-business.github.io`.
2. In Render, choose **New → Blueprint**, select this repository and the `main` branch. Render reads `render.yaml` and creates the `al-business-agent-api-albusiness` web service. The Blueprint selects the paid **Starter** plan so the API does not use the free-instance sleep behavior; verify pricing/current availability in Render before creating it.
3. In the new service's **Environment** settings, add `AI_API_KEY` and `AI_MODEL`. Keep the key in Render's environment settings only; never commit it to GitHub or put it in `config.js`. The Blueprint sets Groq's OpenAI-compatible base URL by default. To use Gemini, change `AI_BASE_URL` to `https://generativelanguage.googleapis.com/v1beta/openai` and choose a model available to your account.
4. Wait for the first deploy to finish. Test `https://al-business-agent-api-albusiness.onrender.com/health`; it should return JSON with `"status":"ok"`. If Render assigns a different service hostname, update `window.AL_BUSINESS_API_URL` in the repository's root `config.js` to that exact HTTPS origin and commit the change. GitHub Pages then republishes the frontend.
5. The Blueprint sets `ALLOWED_ORIGINS=https://al-business.github.io`. If the site is served from another origin, update that variable in Render to the exact origin, without a trailing slash, and redeploy.
6. Test the API (this makes real model calls and may incur provider charges):

```sh
curl -X POST https://al-business-agent-api-albusiness.onrender.com/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://al-business.github.io' \
  -d '{"message":"Yeni onlayn mağaza üçün MVP planı və agentlər üzrə iş bölgüsü hazırla"}'
```

A successful response contains individual `agents` results. The website chat and task form send requests to this API; when it is unavailable or unconfigured, the UI shows an error rather than a fabricated answer.

## Deploy behavior and security

- Render auto-deploys backend changes pushed to the connected branch. The frontend is separately published by GitHub Pages.
- The service uses `/health` for health checks. `PORT` is supplied by Render; the server listens on `0.0.0.0`.
- Use only one deployment platform for the backend at a time (Render, Docker Compose, or PM2).
- The chat endpoint is internet-accessible and has basic IP rate limiting. Before production use, add authentication/abuse controls and set spending limits at the AI provider. CORS is not authentication.
- Never commit `backend/.env`; the root `.gitignore` excludes it. Rotate the provider key immediately if it is ever exposed.

## Local development

```sh
cd backend
cp .env.example .env
# Fill in AI_API_KEY and AI_MODEL in .env.
npm install
npm start
```

Set the frontend API URL in `config.js` to `http://localhost:3000` for local browser testing, and set `ALLOWED_ORIGINS` in `backend/.env` to the exact origin used to serve the frontend. Restore the Render URL before committing/deploying the public site.
