import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://al-business.github.io")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const maxTokens = Math.max(128, Math.min(Number(process.env.AI_MAX_TOKENS || 900), 3000));
const timeoutMs = Math.max(5000, Math.min(Number(process.env.AI_TIMEOUT_MS || 60000), 120000));
const maxJobAttempts = Math.max(1, Math.min(Number(process.env.MAX_JOB_ATTEMPTS || 3), 5));
const workerPollMs = Math.max(1000, Number(process.env.WORKER_POLL_MS || 2000));
const leaseSeconds = Math.max(90, Number(process.env.JOB_LEASE_SECONDS || 180));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for durable agent jobs.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "16kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }));

const agents = [
  { name: "CEO", role: "Strategiya rəhbəri", instruction: "Tələbi təhlil et, məqsədi, əhatə dairəsini, fərziyyələri və prioritetli icra planını ver. Qeyri-müəyyənlikləri açıq qeyd et." },
  { name: "CODER", role: "Proqram təminatı mühəndisi", instruction: "Texniki həlli, arxitekturanı, əsas komponentləri və uyğun olduqda kod/implementasiya addımlarını təklif et. Test edilə bilməyən iddialardan qaç." },
  { name: "DB", role: "Məlumat arxitektoru", instruction: "Məlumat modeli, əsas obyektlər, əlaqələr, indekslər və təhlükəsiz məlumat idarəetməsi barədə təklif ver. Tapşırıqda DB yoxdursa, bunu bildir." },
  { name: "DEVOPS", role: "DevOps mühəndisi", instruction: "İnfrastruktur, konfiqurasiya, deploy, monitorinq və bərpa addımlarını yaz. Sirrləri heç vaxt kodda saxlamağı tövsiyə etmə." },
  { name: "QA", role: "Keyfiyyət təminatı", instruction: "Riskləri, qəbul meyarlarını, test ssenarilərini və kənar halları müəyyən et." },
  { name: "DEPLOY", role: "Yerləşdirmə mütəxəssisi", instruction: "Yoxlama siyahısı, buraxılış və rollback addımlarını təklif et. Heç bir deploy və ya xarici əməliyyatı həqiqətən icra etdiyini iddia etmə." }
];

function validateConfig() {
  if (!process.env.AI_API_KEY || !process.env.AI_BASE_URL || !process.env.AI_MODEL) {
    const error = new Error("AI_API_KEY, AI_BASE_URL və AI_MODEL Render-də konfiqurasiya edilməlidir.");
    error.status = 503;
    throw error;
  }
}

function isRetryable(error) {
  return error.retryable === true || [429, 502, 503, 504].includes(error.status);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callModel(agent, task, context = "") {
  const baseUrl = process.env.AI_BASE_URL.replace(/\/+$/, "");
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL,
          temperature: 0.4,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: `Sən Al Business sistemində ${agent.role} rolunda çalışan peşəkar AI agentsən. ${agent.instruction} Cavabı istifadəçinin dilində ver. Təhlükəli və ya dəstəklənməyən əməliyyatları icra etdiyini iddia etmə.` },
            ...(context ? [{ role: "assistant", content: `CEO-nun iş bölgüsü və konteksti:\n${context}` }] : []),
            { role: "user", content: task }
          ]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) {
        const error = new Error(response.status === 401 || response.status === 403
          ? "AI provayderinin açarı və ya icazəsi yanlışdır. Render environment variables-i yoxlayın."
          : `AI provayderi sorğunu qəbul etmədi (HTTP ${response.status}).`);
        error.status = response.status === 429 ? 429 : (response.status >= 500 ? 502 : 400);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        const error = new Error("AI provayderindən boş cavab alındı.");
        error.status = 502;
        error.retryable = true;
        throw error;
      }
      return text.trim();
    } catch (error) {
      lastError = error;
      if (error.name === "TimeoutError" || error.name === "AbortError" || error.name === "TypeError") {
        lastError = new Error("AI provayderinə müvəqqəti qoşulma xətası.");
        lastError.status = 504;
        lastError.retryable = true;
      }
      if (!isRetryable(lastError) || attempt === 3) throw lastError;
      await sleep(500 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

async function saveAgentResult(jobId, agent, reply) {
  await pool.query(
    `UPDATE agent_jobs
       SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
           updated_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [jobId, agent.name, JSON.stringify({ name: agent.name, role: agent.role, reply })]
  );
}

async function executeJob(job) {
  validateConfig();
  const saved = job.result || {};
  let plan = saved.CEO?.reply;
  if (!plan) {
    plan = await callModel(agents[0], `İstifadəçi tapşırığı:\n${job.message}\n\nDigər beş agent üçün qısa, konkret iş bölgüsü və əsas kontekst hazırla.`);
    await saveAgentResult(job.id, agents[0], plan);
  }
  for (const agent of agents.slice(1)) {
    if (saved[agent.name]?.reply) continue;
    const reply = await callModel(agent, `İstifadəçi tapşırığı:\n${job.message}\n\nSənin iş bölgün və kontekst:\n${plan}`, plan);
    await saveAgentResult(job.id, agent, reply);
  }
  const { rows } = await pool.query("SELECT result FROM agent_jobs WHERE id = $1", [job.id]);
  const finalResults = rows[0]?.result || {};
  const completed = agents.map((agent) => finalResults[agent.name]).filter(Boolean);
  if (completed.length !== agents.length) throw new Error("İş nəticələri saxlanmadı; təhlükəsiz retry ediləcək.");
  return completed;
}

let stopping = false;
let activeJob = null;

async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, message, result, attempts
         FROM agent_jobs
        WHERE (status = 'queued' AND available_at <= NOW())
           OR (status = 'running' AND lease_until < NOW())
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    if (!rows.length) {
      await client.query("COMMIT");
      return null;
    }
    const job = rows[0];
    await client.query(
      `UPDATE agent_jobs
          SET status = 'running', attempts = attempts + 1,
              lease_until = NOW() + ($2 * INTERVAL '1 second'),
              updated_at = NOW(), last_error = NULL
        WHERE id = $1`,
      [job.id, leaseSeconds]
    );
    await client.query("COMMIT");
    return { ...job, attempts: Number(job.attempts) + 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function processJob(job) {
  activeJob = job.id;
  const heartbeat = setInterval(() => {
    pool.query(
      "UPDATE agent_jobs SET lease_until = NOW() + ($2 * INTERVAL '1 second'), updated_at = NOW() WHERE id = $1 AND status = 'running'",
      [job.id, leaseSeconds]
    ).catch((error) => console.error("Job lease heartbeat failed:", error.message));
  }, Math.max(15000, Math.floor(leaseSeconds * 500)));
  try {
    const results = await executeJob(job);
    const reply = results.map((item) => `### ${item.name} — ${item.role}\n${item.reply}`).join("\n\n");
    await pool.query(
      "UPDATE agent_jobs SET status = 'completed', result = $2::jsonb, lease_until = NULL, last_error = NULL, updated_at = NOW(), completed_at = NOW() WHERE id = $1 AND status = 'running'",
      [job.id, JSON.stringify(Object.fromEntries(results.map((item) => [item.name, item])))]
    );
    console.info(`Agent job ${job.id} completed.`);
  } catch (error) {
    const terminal = job.attempts >= maxJobAttempts || error.status === 400 || error.status === 503;
    const delaySeconds = Math.min(300, 10 * (2 ** Math.max(0, job.attempts - 1)));
    await pool.query(
      `UPDATE agent_jobs
          SET status = $2,
              available_at = CASE WHEN $2 = 'queued' THEN NOW() + ($3 * INTERVAL '1 second') ELSE available_at END,
              lease_until = NULL,
              last_error = $4,
              updated_at = NOW(),
              completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END
        WHERE id = $1 AND status = 'running'`,
      [job.id, terminal ? "failed" : "queued", delaySeconds, String(error.message || "Unknown error").slice(0, 1000)]
    );
    console.error(`Agent job ${job.id} ${terminal ? "failed" : "will retry"}:`, error.message);
  } finally {
    clearInterval(heartbeat);
    activeJob = null;
  }
}

async function workerLoop() {
  while (!stopping) {
    try {
      const job = await claimJob();
      if (job) await processJob(job);
      else await sleep(workerPollMs);
    } catch (error) {
      console.error("Worker loop recovered from error:", error.message);
      await sleep(Math.min(10000, workerPollMs * 2));
    }
  }
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "al-business-agent-api", worker: activeJob ? "working" : "idle" });
  } catch {
    res.status(503).json({ status: "error", service: "al-business-agent-api" });
  }
});
app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued FROM agent_jobs");
    res.json({ status: "ok", aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL), worker: activeJob ? "working" : "idle", queuedJobs: rows[0].queued });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

async function enqueueHandler(req, res, next) {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: "Mesaj boş ola bilməz və 2000 simvoldan uzun olmamalıdır." });
    }
    const { rows } = await pool.query(
      "INSERT INTO agent_jobs (message, status) VALUES ($1, 'queued') RETURNING id, status, created_at",
      [message]
    );
    res.status(202).json(rows[0]);
  } catch (error) {
    next(error);
  }
}
app.post("/api/chat", enqueueHandler);
app.post("/api/agents/run", enqueueHandler);

app.get("/api/agents/jobs/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, status, attempts, result, last_error, created_at, updated_at, completed_at FROM agent_jobs WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Tapşırıq tapılmadı." });
    const job = rows[0];
    const results = job.result || {};
    const orderedAgents = agents.map((agent) => results[agent.name]).filter(Boolean);
    const reply = orderedAgents.map((item) => `### ${item.name} — ${item.role}\n${item.reply}`).join("\n\n");
    res.json({ ...job, agents: orderedAgents, reply });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: "Bu saytın API-yə qoşulmasına icazə verilməyib." });
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status === 500) console.error(error);
  return res.status(status).json({ error: status === 500 ? "Server xətası. Server qeydlərini yoxlayın." : error.message });
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id BIGSERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lease_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS agent_jobs_queue_idx ON agent_jobs (status, available_at, created_at)");
  const server = app.listen(port, host, () => console.log(`Al Business durable agent worker listening on ${host}:${port}`));
  workerLoop();
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error) => {
  console.error("Backend startup failed:", error);
  process.exit(1);
});
