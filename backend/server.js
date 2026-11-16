import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Sandbox } from "e2b";
import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://al-business.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const maxTokens = Math.max(128, Math.min(Number(process.env.AI_MAX_TOKENS || 1400), 4000));
const timeoutMs = Math.max(5000, Math.min(Number(process.env.AI_TIMEOUT_MS || 60000), 120000));
const repoRoot = path.resolve(process.env.REPO_WRITE_DIR || path.resolve(process.cwd(), ".."));

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "16kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }));

const agents = [
  { name: "CEO", role: "Strategiya rəhbəri", instruction: "Tələbəni təhlil et, məqsəd, çərçivə, risklər və prioritetli icra planını ver." },
  { name: "CODER", role: "Proqram mühəndisi", instruction: "Texniki həlli, arxitekturanı, əsas komponentləri və mümkün olan addımları ver." },
  { name: "DB", role: "Məlumat arxitektoru", instruction: "Məlumat modeli, əsas obyektlər, əlaqələr, təhlükəsizlik və saxlama strategiyasını ver." },
  { name: "DEVOPS", role: "DevOps mühəndisi", instruction: "İnfrastruktur, deploy, monitoring və rollback planını ver; həssas dəyərləri kodda saxlama." },
  { name: "QA", role: "Keyfiyyət təminatı", instruction: "Risklər, test ssenariləri, qəbul meyarları və kənar halları müəyyən et." },
  { name: "DEPLOY", role: "Buraxılış mütəxəssisi", instruction: "Buraxılış, yoxlama və rollback addımlarını yaz; heç vaxt real deploy etməyi iddia etme." },
];

function validateConfig() {
  if (!process.env.AI_API_KEY || process.env.AI_API_KEY === "replace_with_provider_key") {
    throw Object.assign(new Error("AI_API_KEY təyin edilməlidir."), { status: 503 });
  }
  if (!process.env.AI_BASE_URL || !process.env.AI_MODEL || process.env.AI_MODEL === "replace_with_model_name") {
    throw Object.assign(new Error("AI_BASE_URL və AI_MODEL təyin edilməlidir."), { status: 503 });
  }
}

async function callModel(agent, task, context = "") {
  validateConfig();
  const baseUrl = String(process.env.AI_BASE_URL).trim().replace(/\/+$/, "");
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL,
          temperature: 0.35,
          max_tokens: maxTokens,
          messages: [
            {
              role: "system",
              content: `Sən Al Business sistemində ${agent.role} rolunda işləyən peşəkar AI agentsən. ${agent.instruction} Cavabı istifadəçinin dilində ver. Heç bir real əməliyyat, deploy, repo yazma, shell icrası və ya təhlükəli hərəkət etməyi iddia etme.`,
            },
            ...(context ? [{ role: "assistant", content: `CEO-nun ilkin konteksti:\n${context}` }] : []),
            { role: "user", content: task },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const error = new Error(response.status === 401 || response.status === 403 ? "AI provayderinin açarı və ya icazəsi yanlışdır." : `AI provayderi xətaya düştü (HTTP ${response.status}).`);
        error.status = response.status === 429 ? 429 : 502;
        throw error;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("AI provayderi boş cavab verdi.");
      }
      return text.trim();
    } catch (error) {
      lastError = error;
      const retryable = error.name === "AbortError" || error.name === "TimeoutError" || error.status === 429 || error.status === 502 || error.status === 503;
      if (!retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }

  throw lastError ?? new Error("AI model çağırışı uğursuz oldu.");
}

async function runAgents(message) {
  validateConfig();
  const ceo = agents[0];
  const plan = await callModel(ceo, `İstifadəçi tapşırığı:\n${message}\n\nDigər beş agent üçün qısa, konkret iş bölgüsü və əsas kontekst hazırla.`, "");
  const specialistResults = await Promise.allSettled(
    agents.slice(1).map(async (agent) => ({
      name: agent.name,
      role: agent.role,
      reply: await callModel(agent, `İstifadəçi tapşırığı:\n${message}\n\nSənin iş bölgün və kontekst:\n${plan}`, plan),
    }))
  );

  const results = [{ name: ceo.name, role: ceo.role, reply: plan }];
  const failures = [];

  specialistResults.forEach((result, index) => {
    if (result.status === "fulfilled") results.push(result.value);
    else failures.push(agents[index + 1].name);
  });

  if (results.length < 2) {
    const error = new Error("Agentlərdən cavab alınmadı.");
    error.status = 502;
    throw error;
  }

  return {
    reply: results.map((item) => `### ${item.name} — ${item.role}\n${item.reply}`).join("\n\n"),
    agents: results,
    ...(failures.length ? { failedAgents: failures } : {}),
  };
}

function safeParseJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

const allowedExtensions = new Set([".html", ".css", ".js", ".ts", ".json", ".md", ".txt", ".py", ".yml", ".yaml", ".toml"]);

function normalizeProjectFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 8) {
    throw Object.assign(new Error("Agent 1–8 fayl qaytarmalıdır."), { status: 400 });
  }

  const normalized = [];
  const seen = new Set();
  let totalBytes = 0;

  for (const entry of files) {
    if (!entry || typeof entry.path !== "string" || typeof entry.content !== "string") {
      throw Object.assign(new Error("Fayl forması yanlışdır."), { status: 400 });
    }

    const safePath = entry.path.trim().replace(/\\/g, "/");
    if (!safePath || safePath.startsWith("/") || /(^|\/)(\.git|node_modules)(\/|$)/i.test(safePath)) {
      throw Object.assign(new Error(`Qadağan edilmiş fayl yolu: ${safePath}`), { status: 400 });
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(safePath) || safePath.split("/").some((part) => !part || part === "." || part === "..")) {
      throw Object.assign(new Error(`Yanlış fayl yolu: ${safePath}`), { status: 400 });
    }

    const ext = safePath.includes(".") ? safePath.slice(safePath.lastIndexOf(".")) : "";
    if (!allowedExtensions.has(ext.toLowerCase())) {
      throw Object.assign(new Error(`Qadağan edilmiş fayl tipi: ${safePath}`), { status: 400 });
    }

    if (seen.has(safePath)) {
      throw Object.assign(new Error(`Təkrarlanan fayl yolu: ${safePath}`), { status: 400 });
    }
    seen.add(safePath);

    const bytes = Buffer.byteLength(entry.content, "utf8");
    if (bytes > 32 * 1024) {
      throw Object.assign(new Error(`${safePath} faylı 32 KB limitini keçir.`), { status: 400 });
    }
    totalBytes += bytes;
    normalized.push({ path: safePath, content: entry.content });
  }

  if (totalBytes > 160 * 1024) {
    throw Object.assign(new Error("Faylların toplam həcmi 160 KB limitini keçir."), { status: 400 });
  }

  return normalized;
}

async function validateInSandbox(files) {
  if (!process.env.E2B_API_KEY) {
    return { status: "not-configured", note: "E2B_API_KEY yoxdur; sandbox yoxlaması keçməyib.", checks: [] };
  }

  let sandbox;
  const checks = [];

  try {
    sandbox = await Sandbox.create({ timeoutMs: 120_000 });
    for (const file of files) {
      const ext = file.path.toLowerCase().slice(file.path.lastIndexOf("."));
      if (ext !== ".js" && ext !== ".py") continue;

      const filePath = `/workspace/${file.path}`;
      await sandbox.files.write(filePath, file.content);

      const result = ext === ".js"
        ? await sandbox.commands.run(`node --check ${filePath}`, { timeoutMs: 10000 })
        : await sandbox.commands.run(`python -m py_compile ${filePath}`, { timeoutMs: 10000 });

      checks.push({
        path: file.path,
        status: result.exitCode === 0 ? "passed" : "failed",
        output: String(result.stderr || result.stdout || "").slice(0, 2000),
      });
    }

    const failed = checks.some((item) => item.status === "failed");
    return {
      status: failed ? "failed" : checks.length ? "passed" : "no-supported-files",
      checks,
    };
  } catch (error) {
    console.error("Sandbox validation failed:", error);
    return {
      status: "error",
      checks,
      note: "Sandbox yoxlaması baş tutmadı; fayllar işlədiyini iddia etməyin.",
    };
  } finally {
    if (sandbox) {
      await sandbox.kill().catch((error) => console.error("Sandbox cleanup failed:", error));
    }
  }
}

async function buildProject(message) {
  const coder = {
    name: "CODER",
    role: "Software Engineer",
    instruction: "Generate a coherent, minimal project from the user's task while staying safe and within limits.",
  };

  const prompt = `Create a small but realistic project for this task:\n${message}\n\nReturn ONLY valid JSON in this exact shape:\n{"summary":"short summary","files":[{"path":"relative/path.ext","content":"full file content"}]}.\nRules:\n- At most 8 files\n- Each file <= 32KB\n- Use only safe relative paths\n- Allowed extensions: html, css, js, ts, json, md, txt, py, yml, yaml, toml\n- Do not include secrets, .env files, malicious code, exploitation steps, or scanning / scraping / credential theft\n- Do not claim execution or deployment\n- Do not include markdown fences\n- Escape JSON values correctly.`;

  const raw = await callModel(coder, prompt);
  const payload = safeParseJson(raw);
  const files = normalizeProjectFiles(payload.files ?? []);
  const validation = await validateInSandbox(files);

  return {
    summary: String(payload.summary || "Layihə faylları hazırlandı.").slice(0, 1200),
    files,
    validation,
  };
}

function ensureRepoWriteEnabled() {
  if (process.env.ALLOW_REPO_WRITE !== "true") {
    throw Object.assign(new Error("Repo write is disabled. Set ALLOW_REPO_WRITE=true and REPO_WRITE_DIR to the repo root."), { status: 403 });
  }
}

function resolveRepoFilePath(filePath) {
  const target = path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error(`Unsafe repo write path: ${filePath}`), { status: 400 });
  }
  return target;
}

async function writeProjectFilesToRepo(fileList) {
  ensureRepoWriteEnabled();
  const written = [];
  for (const file of normalizeProjectFiles(fileList)) {
    const absolutePath = resolveRepoFilePath(file.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, "utf8");
    written.push({ path: file.path, absolutePath });
  }
  return written;
}

const jobs = new Map();
let nextJobId = 1;

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.updatedAt = new Date().toISOString();

  try {
    const result = await runAgents(job.message);
    job.agents = result.agents;
    job.reply = result.reply;
    job.failedAgents = result.failedAgents || [];
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  } catch (error) {
    job.status = "failed";
    job.lastError = error.message || "Agent tapşırığı uğursuz oldu.";
    job.completedAt = new Date().toISOString();
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
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

function enqueueTask(message) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed || trimmed.length > 2000) {
    throw Object.assign(new Error("Mesaj boş ola bilməz və 2000 simvoldan uzun olmamalıdır."), { status: 400 });
  }

  const id = nextJobId += 1;
  const createdAt = new Date().toISOString();
  const job = {
    id,
    message: trimmed,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    agents: [],
    failedAgents: [],
  };
  jobs.set(id, job);
  return id;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "al-business-agent-api" });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL),
    e2bConfigured: Boolean(process.env.E2B_API_KEY),
    repoWriteEnabled: process.env.ALLOW_REPO_WRITE === "true",
    repoRoot,
    queuedJobs: [...jobs.values()].filter((job) => job.status === "queued").length,
  });
});

app.post("/api/chat", async (req, res, next) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: "Mesaj boş ola bilməz və 2000 simvoldan uzun olmamalıdır." });
    }

    const id = enqueueTask(message);
    return res.status(202).json({ id, status: "queued" });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/agents/run", async (req, res, next) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: "Mesaj boş ola bilməz və 2000 simvoldan uzun olmamalıdır." });
    }

    const id = enqueueTask(message);
    return res.status(202).json({ id, status: "queued" });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/agents/jobs/:id", (req, res) => {
  const jobId = Number(req.params.id);
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: "Tapşırıq tapılmadı." });
  return res.json(job);
});

app.post("/api/agent/build", async (req, res, next) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: "Tapşırıq boş ola bilməz və 2000 simvoldan uzun olmamalıdır." });
    }

    const payload = await buildProject(message);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/agent/write", async (req, res, next) => {
  try {
    const approved = req.body?.approved === true;
    const files = req.body?.files;
    if (!approved) {
      return res.status(400).json({ error: "Repo yazmaq üçün approved: true göndərilməlidir." });
    }
    const written = await writeProjectFilesToRepo(files || []);
    return res.json({
      ok: true,
      repoRoot,
      written,
      message: "Fayllar repoya yazıldı. Commit etməzdən əvvəl nəzərdən keçirin.",
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ error: "Bu saytın API-yə qoşulmasına icazə verilməyib." });
  }
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: error.message || "Server xətası." });
});

workerLoop().catch((error) => {
  console.error("Worker loop crashed:", error);
  process.exit(1);
});

app.listen(port, host, () => {
  console.log(`Al Business agent API listening on ${host}:${port}`);
});

export default app;
