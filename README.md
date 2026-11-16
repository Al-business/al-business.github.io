# Al Business Coding Agent

The project builder generates a small set of reviewable project files and returns them for download. If `E2B_API_KEY` is configured, JavaScript and Python files receive bounded syntax-only checks inside a short-lived E2B sandbox. The sandbox is always terminated after the checks. The agent does not run project scripts, install dependencies, access a user's repository, make network requests from the sandbox, push changes, or deploy.

## Local setup

1. Install Node.js 20+.
2. In `backend`, copy `.env.example` to `.env`; set `AI_API_KEY`, `AI_MODEL`, and optionally `E2B_API_KEY`.
3. Run `npm install && npm start` inside `backend`.
4. Open the GitHub Pages site. For local API use, set `config.js` to `http://localhost:3000`.

## Render setup

The repo's `render.yaml` declares a web service. Create/update the Render service from the Blueprint. Set `AI_API_KEY`, `AI_MODEL`, and `E2B_API_KEY` in Render environment settings; keep them out of GitHub. Verify the actual Render service URL and set it in `config.js`. Set `ALLOWED_ORIGINS` to the exact GitHub Pages origin. Check `/health` and `/api/health` after deploy.

## API

- `GET /health`
- `GET /api/health`
- `POST /api/chat` and `/api/agents/run`: enqueue agent discussion task
- `GET /api/agents/jobs/:id`: poll in-memory task status
- `POST /api/agent/build`: generate and validate a limited project file set

## Limits and production requirements

The job queue is in memory and lost on restart. Generated files are returned to the browser and are not written into a repository. The sandbox currently performs syntax checks only; that is not a full test run or proof the project works. Without `E2B_API_KEY`, generation still works if the AI provider is configured, but sandbox validation is skipped. Use persistent job storage, authenticated users, per-user quotas, audit logs, stronger abuse controls, and a reviewed sandbox policy before public production use.
