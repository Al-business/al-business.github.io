import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import "dotenv/config";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,https://al-business.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json({ limit: "16kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }));

const agents = [
  { name: "CEO", role: "Strategy Lead", instruction: "Analyze the business goal, constraints, and prioritization." },
  { name: "CODER", role: "Software Engineer", instruction: "Design the technical architecture and implementation steps." },
  { name: "DB", role: "Data Architect", instruction: "Define schema, entities, and storage strategy." },
  { name: "DEVOPS", role: "DevOps Engineer", instruction: "Define environment, deployment, and recovery steps." },
  { name: "QA", role: "Quality Engineer", instruction: "Define tests, risks, and validation checks." },
  { name: "DEPLOY", role: "Release Engineer", instruction: "Define launch and rollback plan." },
];

const jobs = new Map();
let nextJobId = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildFallbackPlan(task) {
  const trimmed = task.trim();
  return `Strategic summary for: "${trimmed}"\n\n1. Scope the product and clarify the business objective.\n2. Split the implementation into backend, database, deployment, and validation tasks.\n3. Keep the first delivery small, reviewable, and testable.\n4. Add rollback and monitoring before production launch.`;
}

function buildFallbackReply(agent, task, plan) {
  const taskPreview = task.trim().slice(0, 180) || "new request";
  return `${agent.name} (${agent.role})\n- Context: ${taskPreview}\n- Execution: ${agent.instruction}\n- Output: ${plan.slice(0, 180)}...`;
}

async function callAIModel(agent, task, context = "") {
  const baseUrl = (process.env.AI_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.AI_API_KEY || "").trim();
  const model = (process.env.AI_MODEL || "").trim();

  if (!baseUrl || !apiKey || !model) {
    return buildFallbackReply(agent, task, context || buildFallbackPlan(task));
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: Number(process.env.AI_MAX_TOKENS || 900),
        messages: [
          { role: "system", content: `You are ${agent.role} in an AI project team. ${agent.instruction} Be concise and practical.` },
          ...(context ? [{ role: "assistant", content: context }] : []),
          { role: "user", content: task },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 60000)),
    });

    if (!response.ok) {
      throw new Error(`AI provider rejected request with HTTP ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI provider returned an empty response");
    }
    return content.trim();
  } catch (error) {
    console.warn(`AI fallback for ${agent.name}:`, error.message);
    return buildFallbackReply(agent, task, context || buildFallbackPlan(task));
  }
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.updatedAt = new Date().toISOString();

  try {
    const ceo = agents[0];
    const plan = await callAIModel(ceo, `User task: ${job.message}`, "");

    const results = [{ name: ceo.name, role: ceo.role, reply: plan }];
    for (const agent of agents.slice(1)) {
      const reply = await callAIModel(agent, `User task: ${job.message}`, plan);
      results.push({ name: agent.name, role: agent.role, reply });
    }

    job.agents = results;
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.reply = results.map((item) => `### ${item.name} — ${item.role}\n${item.reply}`).join("\n\n");
  } catch (error) {
    job.status = "failed";
    job.lastError = error.message;
  }

  job.updatedAt = new Date().toISOString();
}

async function workerLoop() {
  while (true) {
    for (const [jobId, job] of jobs.entries()) {
      if (job.status === "queued") {
        await processJob(jobId);
      }
    }
    await sleep(1000);
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "al-business-agent-api" });
});

app.get("/api/health", (_req, res) => {
  const queued = [...jobs.values()].filter((job) => job.status === "queued").length;
  const running = [...jobs.values()].filter((job) => job.status === "running").length;
  res.json({ status: "ok", queuedJobs: queued, runningJobs: running });
});

app.post("/api/agents/run", (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  const jobId = nextJobId++;
  const job = {
    id: jobId,
    message,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    agents: [],
  };
  jobs.set(jobId, job);

  return res.status(202).json({ id: jobId, status: job.status, createdAt: job.createdAt });
});

app.get("/api/agents/jobs/:id", (req, res) => {
  const job = jobs.get(Number(req.params.id));
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  const payload = {
    id: job.id,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    lastError: job.lastError || null,
    agents: job.agents || [],
    reply: job.reply || null,
  };

  return res.json(payload);
});

app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ error: "This origin is not allowed to access the API." });
  }
  console.error(error);
  res.status(500).json({ error: error.message || "Server error" });
});

workerLoop().catch((error) => {
  console.error("Worker loop crashed:", error);
  process.exit(1);
});

app.listen(port, host, () => {
  console.log(`Al Business agent MVP listening on http://${host}:${port}`);
});
