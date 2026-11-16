import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import "dotenv/config";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const maxTokens = Math.max(128, Math.min(Number(process.env.AI_MAX_TOKENS || 900), 3000));
const timeoutMs = Math.max(5000, Math.min(Number(process.env.AI_TIMEOUT_MS || 60000), 120000));

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
  if (!process.env.AI_API_KEY || process.env.AI_API_KEY === "replace_with_provider_key" ||
      !process.env.AI_BASE_URL || !process.env.AI_MODEL || process.env.AI_MODEL === "replace_with_model_name") {
    const error = new Error("AI backend konfiqurasiya olunmayıb. AI_API_KEY, AI_BASE_URL və AI_MODEL dəyərlərini serverdə təyin edin.");
    error.status = 503;
    throw error;
  }
}

async function callModel(agent, task, context = "") {
  const baseUrl = process.env.AI_BASE_URL.replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
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
          ...(context ? [{ role: "assistant", content: `CEO-nun ilkin tapşırıq konteksti:\n${context}` }] : []),
          { role: "user", content: task }
        ]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      const timeout = new Error("AI provayderinin cavab müddəti bitdi. Bir az sonra yenidən cəhd edin.");
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  }
  if (!response.ok) {
    const error = new Error(response.status === 401 || response.status === 403
      ? "AI provayderinin açarı və ya icazəsi yanlışdır. Server konfiqurasiyasını yoxlayın."
      : `AI provayderi sorğunu qəbul etmədi (HTTP ${response.status}).`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    const error = new Error("AI provayderindən boş cavab alındı.");
    error.status = 502;
    throw error;
  }
  return text.trim();
}

async function runAgents(message) {
  validateConfig();
  const ceo = agents[0];
  const plan = await callModel(ceo, `İstifadəçi tapşırığı:\n${message}\n\nDigər beş agent üçün qısa, konkret iş bölgüsü və əsas kontekst hazırla.`, "");
  const specialistResults = await Promise.allSettled(
    agents.slice(1).map(async (agent) => ({
      name: agent.name,
      role: agent.role,
      reply: await callModel(agent, `İstifadəçi tapşırığı:\n${message}\n\nSənin iş bölgün və kontekst:\n${plan}`, plan)
    }))
  );
  const results = [{ name: ceo.name, role: ceo.role, reply: plan }];
  const failures = [];
  specialistResults.forEach((result, index) => {
    if (result.status === "fulfilled") results.push(result.value);
    else failures.push(agents[index + 1].name);
  });
  if (results.length < 2) {
    const error = new Error("Agentlərdən cavab alınmadı. Server qeydlərini yoxlayıb yenidən cəhd edin.");
    error.status = 502;
    throw error;
  }
  const reply = results.map((item) => `### ${item.name} — ${item.role}\n${item.reply}`).join("\n\n");
  return { reply, agents: results, ...(failures.length ? { failedAgents: failures } : {}) };
}

app.get("/health", (_req, res) => res.json({ status: "ok", service: "al-business-agent-api" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL) }));

async function chatHandler(req, res, next) {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: "Mesaj boş ola bilməz və 2000 simvoldan uzun olmamalıdır." });
    }
    return res.json(await runAgents(message));
  } catch (error) {
    return next(error);
  }
}
app.post("/api/chat", chatHandler);
app.post("/api/agents/run", chatHandler);

app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: "Bu saytın API-yə qoşulmasına icazə verilməyib." });
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status === 500) console.error(error);
  return res.status(status).json({ error: status === 500 ? "Server xətası. Server qeydlərini yoxlayın." : error.message });
});

app.listen(port, host, () => console.log(`Al Business agent API listening on ${host}:${port}`));
