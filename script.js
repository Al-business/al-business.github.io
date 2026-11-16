document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");
  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      nav.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    }));
  }

  const taskInput = document.getElementById("taskInput");
  const launch = document.getElementById("launchBtn");
  const reset = document.getElementById("resetBtn");
  const runHero = document.getElementById("runWorkflowBtn");
  const log = document.querySelector(".log-panel");
  const apiBase = (window.AL_BUSINESS_API_URL || "").trim().replace(/\/+$/, "");

  function addLog(agent, text) {
    if (!log) return;
    const row = document.createElement("div");
    row.className = "log-entry";
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = agent;
    const message = document.createElement("span");
    message.className = "log-message";
    message.textContent = text;
    row.append(time, name, message);
    log.prepend(row);
  }

  async function submitTask() {
    const message = taskInput?.value.trim();
    if (!message) return taskInput?.focus();
    if (!apiBase) return addLog("XƏTA", "Backend ünvanı qurulmayıb. Real agentlər işləyə bilməz.");
    launch.disabled = true;
    addLog("SYSTEM", "Tapşırıq davamlı növbəyə yazılır...");
    try {
      const response = await fetch(`${apiBase}/api/agents/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `API xətası (${response.status})`);
      addLog("SYSTEM", `Tapşırıq #${data.id} növbəyə yazıldı; agent nəticələri gözlənilir.`);
      let done = false;
      while (!done) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`${apiBase}/api/agents/jobs/${encodeURIComponent(data.id)}`);
        const state = await poll.json().catch(() => ({}));
        if (!poll.ok) throw new Error(state.error || `Status sorğusu xətası (${poll.status})`);
        (state.agents || []).forEach((agent) => {
          const key = `${data.id}:${agent.name}`;
          if (!window.__seenAgentResults) window.__seenAgentResults = new Set();
          if (!window.__seenAgentResults.has(key)) {
            window.__seenAgentResults.add(key);
            addLog(agent.name, agent.reply);
          }
        });
        if (state.status === "completed") {
          addLog("SYSTEM", `Tapşırıq #${data.id} tamamlandı.`);
          done = true;
        } else if (state.status === "failed") {
          addLog("XƏTA", `Tapşırıq #${data.id} dayandı: ${state.last_error || "təkrar cəhd limiti bitdi"}`);
          done = true;
        }
      }
    } catch (error) {
      addLog("XƏTA", error.message || "Backend bağlantısı alınmadı.");
    } finally {
      launch.disabled = false;
    }
  }

  launch?.addEventListener("click", submitTask);
  runHero?.addEventListener("click", () => {
    document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" });
    taskInput?.focus();
  });
  reset?.addEventListener("click", () => {
    if (taskInput) taskInput.value = "";
    if (log) log.replaceChildren();
    taskInput?.focus();
  });
});
