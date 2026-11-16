import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Sandbox } from "e2b";
import "dotenv/config";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://al-business.github.io")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const apiLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });

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
app.use("/api", apiLimit);

const agents = [
  { name: "CEO", role: "Strategiya rəhbəri", instruction: "Tapşırığı təhlil et, məqsədi, məhdudiyyətləri və mərhələli planı ver." },
  { name: "CODER", role: "Proqram təminatı mühəndisi", instruction: "Texniki həlli və implementasiya addımlarını təklif et." },
  { name: "DB", role: "Məlumat arxitektoru", instruction: "Məlumat modelini, əlaqələri və saxlanma strategiyasını təklif et." },
  { name: "DEVOPS", role: "DevOps mühəndisi", instruction: "Konfiqurasiya, deploy və monitorinq planını ver; sirrləri kodda saxlama." },
  { name: "QA", role: "Keyfiyyət təminatı", instruction: "Test ssenariləri, risklər və qəbul meyarlarını müəyyən et." },
  { name: "DEPLOY", role: "Buraxılış mütəxəssisi", instruction: "Buraxılış və rollback yoxlama siyahısını yaz; əməliyyatın icra edildiyini iddia etmə." },
];

// The MVP queue is process-local; use persistent storage before multi-instance production use.
const jobs = new Map();
let nextJobId = 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function aiConfig() {
  const baseUrl = (process.env.AI_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.AI_API_KEY || "").trim();
  const model = (process.env.AI_MODEL || "").trim();
  if (!baseUrl || !apiKey || !model) {
    const error = new Error("AI_API_KEY, AI_BASE_URL və AI_MODEL serverdə konfiqurasiya edilməlidir.");
    error.status = 503;
    throw error;
  }
  return { baseUrl, apiKey, model };
}

async function callModel(agent, task, context = "") {
  const { baseUrl, apiKey, model } = aiConfig();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: Math.max(256, Math.min(Number(process.env.AI_MAX_TOKENS || 1400), 4000)),
          messages: [
            { role: "system", content: `Sən Al Business proqramlaşdırma komandasında ${agent.role} rolundasan. ${agent.instruction} İstifadəçinin dilində cavab ver. Heç vaxt əmri və ya deployu icra etdiyini iddia etmə.` },
            ...(context ? [{ role: "assistant", content: context }] : []),
            { role: "user", content: task },
          ],
        }),
        signal: AbortSignal.timeout(Math.max(5000, Math.min(Number(process.env.AI_TIMEOUT_MS || 60000), 120000))),
      });
      if (!response.ok) {
        const error = new Error(`AI provayderi HTTP ${response.status} qaytardı.`);
        error.status = response.status === 429 || response.status >= 500 ? 503 : 502;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new Error("AI provayderi boş cavab qaytardı.");
      return text.trim();
    } catch (error) {
      lastError = error;
      const retryable = error.retryable || ["AbortError", "TimeoutError", "TypeError"].includes(error.name);
      if (!retryable || attempt === 3) throw error;
      await sleep(400 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 200));
    }
  }
  throw lastError;
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  try {
    const plan = await callModel(agents[0], `İstifadəçi tapşırığı:\n${job.message}\n\nDigər agentlər üçün qısa iş bölgüsü hazırla.`);
    const results = [{ name: agents[0].name, role: agents[0].role, reply: plan }];
    const specialists = await Promise.allSettled(agents.slice(1).map(async (agent) => ({
      name: agent.name,
      role: agent.role,
      reply: await callModel(agent, `Tapşırıq:\n${job.message}`, plan),
    })));
    specialists.forEach((result, index) => {
      if (result.status === "fulfilled") results.push(result.value);
      else job.failedAgents.push(agents[index + 1].name);
    });
    job.agents = results;
    job.status = results.length > 1 ? "completed" : "failed";
    job.lastError = results.length > 1 ? null : "Agentlər cavab vermədi.";
    job.completedAt = new Date().toISOString();
  } catch (error) {
    job.status = "failed";
    job.lastError = error.message || "Agent xətası";
    job.completedAt = new Date().toISOString();
  }
  job.updatedAt = new Date().toISOString();
}

async function workerLoop() {
  while (true) {
    const job = [...jobs.values()].find((item) => item.status === "queued");
    if (job) await processJob(job.id);
    else await sleep(700);
  }
}

function enqueueHandler(req, res) {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 2000) {
    return res.status(400).json({ error: "Mesaj boş ola bilməz və 2000 simvoldan uzun olmamalıdır." });
  }
  const id = nextJobId++;
  const createdAt = new Date().toISOString();
  jobs.set(id, { id, message, status: "queued", createdAt, updatedAt: createdAt, agents: [], failedAgents: [] });
  return res.status(202).json({ id, status: "queued", createdAt });
}

const allowedExtensions = new Set([".html", ".css", ".js", ".ts", ".json", ".md", ".txt", ".py", ".yml", ".yaml", ".toml"]);
function validateGeneratedFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 8) throw new Error("Agent 1–8 layihə faylı qaytarmalıdır.");
  let totalBytes = 0;
  const seen = new Set();
  return files.map((file) => {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") throw new Error("Agent fayl formatı yanlışdır.");
    const path = file.path.trim().replaceAll("\\", "/");
    const parts = path.split("/");
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (!path || path.startsWith("/") || !/^[A-Za-z0-9._/-]+$/.test(path) ||
        parts.some((part) => !part || part === "." || part === "..") ||
        parts.some((part) => part.startsWith(".")) || /(^|\/)(node_modules|\.git)(\/|$)/i.test(path) ||
        /(^|\/)(\.env(?:\.|$)|secrets?\.|id_rsa|credentials?)/i.test(path) || !allowedExtensions.has(ext)) {
      throw new Error(`İcazə verilməyən fayl yolu və ya tipi: ${path}`);
    }
    if (seen.has(path)) throw new Error(`Təkrarlanan fayl yolu: ${path}`);
    seen.add(path);
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > 32_000) throw new Error(`${path} 32 KB limitini keçir.`);
    totalBytes += bytes;
    return { path, content: file.content };
  }).filter((file) => {
    if (totalBytes > 160_000) throw new Error("Layihə fayllarının ümumi ölçüsü limitdən artıqdır.");
    return true;
  });
}

// Validation is intentionally limited to syntax checks. No generated project command,
// package script, dependency installer, or network request is run in this sandbox.
async function validateInSandbox(files) {
  if (!process.env.E2B_API_KEY) {
    return { status: "not-configured", checks: [], note: "E2B_API_KEY təyin edilməyib; sandbox yoxlaması aparılmadı." };
  }
  let sandbox;
  const checks = [];
  try {
    sandbox = await Sandbox.create({ timeoutMs: 120_000 });
    for (const file of files) {
      const extension = file.path.slice(file.path.lastIndexOf(".")).toLowerCase();
      if (![".js", ".py"].includes(extension)) continue;
      const sandboxPath = `/home/user/${file.path}`;
      await sandbox.files.write(sandboxPath, file.content);
      const result = extension === ".js"
        ? await sandbox.commands.run(`node --check /home/user/${file.path}`, { timeoutMs: 10_000 })
        : await sandbox.commands.run(`python -m py_compile /home/user/${file.path}`, { timeoutMs: 10_000 });
      checks.push({ path: file.path, status: result.exitCode === 0 ? "passed" : "failed", output: String(result.stderr || result.stdout || "").slice(0, 2000) });
    }
    const failed = checks.some((check) => check.status === "failed");
    return { status: failed ? "failed" : checks.length ? "passed" : "no-supported-files", checks };
  } catch (error) {
    console.error("Sandbox validation failed:", error.message);
    return { status: "error", checks, note: "Sandbox yoxlaması baş tutmadı; faylları yoxlamadan istifadə etməyin." };
  } finally {
    if (sandbox) await sandbox.kill().catch((error) => console.error("Sandbox cleanup failed:", error.message));
  }
}

app.get("/health", (_req, res) => res.json({ status: "ok", service: "al-business-agent-api" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL), sandboxConfigured: Boolean(process.env.E2B_API_KEY), queuedJobs: [...jobs.values()].filter((job) => job.status === "queued").length }));
app.post("/api/agents/run", enqueueHandler);
app.post("/api/chat", enqueueHandler);

app.get("/api/agents/jobs/:id", (req, res) => {
  const job = jobs.get(Number(req.params.id));
  if (!job) return res.status(404).json({ error: "Tapşırıq tapılmadı." });
  return res.json({ ...job });
});

app.post("/api/agent/build", async (req, res, next) => {
  try {
    const task = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!task || task.length > 2000) return res.status(400).json({ error: "Tapşırıq boş ola bilməz və 2000 simvoldan uzun olmamalıdır." });
    const coder = { name: "CODER", role: "Software Engineer", instruction: "Generate a small, coherent project from the user's specification." };
    const prompt = `Create a small working project that addresses this task:\n${task}\n\nReturn ONLY valid JSON with this exact shape: {"summary":"short summary","files":[{"path":"relative/path.ext","content":"complete file content"}]}. Return at most 8 files, each at most 32KB. Use only relative paths and these extensions: html, css, js, ts, json, md, txt, py, yml, yaml, toml. Include a README when useful. Do not include secrets, .env files, destructive commands, malware, credential collection, exploitation, or instructions to attack real targets. Do not claim files were run or tested. Escape JSON strings correctly.`;
    const raw = await callModel(coder, prompt);
    let payload;
    try {
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      payload = JSON.parse(jsonText);
    } catch {
      const error = new Error("Agent cavabı düzgün layihə JSON-u deyil; tapşırığı sadələşdirib yenidən cəhd edin.");
      error.status = 502;
      throw error;
    }
    const files = validateGeneratedFiles(payload.files);
    const validation = await validateInSandbox(files);
    return res.json({ summary: String(payload.summary || "Layihə faylları hazırlandı.").slice(0, 1000), files, validation, execution: "syntax-check-only" });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: "Bu saytın API-yə qoşulmasına icazə verilməyib." });
  const status = Number.isInteger(error.status) ? error.status : 400;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: error.message || "Server xətası." });
});

workerLoop().catch((error) => {
  console.error("Worker loop crashed:", error);
  process.exit(1);
});
app.listen(port, host, () => console.log(`Al Business agent API listening on ${host}:${port}`));
