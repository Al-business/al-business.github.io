document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const logPanel = document.querySelector(".log-panel");
  const appendLog = (agent, message) => {
    if (!logPanel) return;
    const entry = document.createElement("div");
    entry.className = "log-entry";
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const timeEl = document.createElement("span");
    timeEl.className = "time";
    timeEl.textContent = time;
    const agentEl = document.createElement("span");
    agentEl.className = "agent-name";
    agentEl.textContent = agent;
    const messageEl = document.createElement("span");
    messageEl.className = "log-message";
    messageEl.textContent = message;
    entry.append(timeEl, agentEl, messageEl);
    logPanel.prepend(entry);
  };

  const runBtn = document.getElementById("launchBtn");
  const resetBtn = document.getElementById("resetBtn");
  const taskInput = document.getElementById("taskInput");
  let workflowRunning = false;

  const runWorkflow = () => {
    if (!taskInput || !logPanel || workflowRunning) return;
    const task = taskInput.value.trim();
    if (!task) {
      taskInput.focus();
      return;
    }

    workflowRunning = true;
    if (runBtn) runBtn.disabled = true;
    appendLog("DEMO", `Nümunə iş axını başladı: ${task}`);
    const steps = [
      ["CEO", "Tələb təhlil edildi (demo)."],
      ["CODER", "Kod tapşırıqları müəyyən edildi (demo)."],
      ["DB", "Verilənlər modeli planlaşdırıldı (demo)."],
      ["DEVOPS", "Yerləşdirmə addımları planlaşdırıldı (demo)."],
      ["QA", "Yoxlama siyahısı hazırlandı (demo)."],
      ["DEPLOY", "Nümunə iş axını tamamlandı; heç nə yerləşdirilmədi."]
    ];

    steps.forEach(([agent, message], index) => {
      window.setTimeout(() => {
        appendLog(agent, message);
        if (index === steps.length - 1) {
          workflowRunning = false;
          if (runBtn) runBtn.disabled = false;
        }
      }, (index + 1) * 350);
    });
  };

  if (runBtn) runBtn.addEventListener("click", runWorkflow);
  if (resetBtn && taskInput) {
    resetBtn.addEventListener("click", () => {
      taskInput.value = "Alibaba üslubunda e-ticarət platforması üçün FastAPI backend, məhsul və istifadəçi cədvəlləri, Dockerfile və docker-compose.yml planlaşdır.";
      if (logPanel) {
        logPanel.replaceChildren();
        const entry = document.createElement("div");
        entry.className = "log-entry";
        entry.textContent = "Demo qeydləri sıfırlandı.";
        logPanel.append(entry);
      }
    });
  }

  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatMessages = document.getElementById("chatMessages");
  const chatStatus = document.getElementById("chatStatus");
  const sendChatBtn = document.getElementById("sendChatBtn");

  const addChatMessage = (role, text) => {
    if (!chatMessages) return;
    const message = document.createElement("div");
    message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = role === "user" ? "SİZ" : "ASSISTANT";
    const content = document.createElement("p");
    content.textContent = text;
    message.append(name, content);
    chatMessages.append(message);
    message.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const makeDemoReply = (message) => {
    const lower = message.toLocaleLowerCase("az");
    if (lower.includes("docker") || lower.includes("server") || lower.includes("uptime")) {
      return "Bu GitHub Pages saytı statikdir və PM2/Docker-da işlədilmir. Agentləri real işlətmək üçün ayrıca backend/API qurub serverdə Docker Compose və ya PM2 ilə idarə etmək, sonra bu çata təhlükəsiz API bağlantısı əlavə etmək lazımdır.";
    }
    return `Tapşırığınız qəbul edildi: “${message}”. Bu cavab demo rejimində yaradılıb, AI modeli tərəfindən hazırlanmayıb. Real cavab və agent icrası üçün server tərəfli AI backend/API inteqrasiyası tələb olunur.`;
  };

  if (chatForm && chatInput) {
    chatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = chatInput.value.trim();
      if (!message) return;

      addChatMessage("user", message);
      chatInput.value = "";
      if (sendChatBtn) sendChatBtn.disabled = true;
      if (chatStatus) chatStatus.textContent = "Cavab hazırlanır...";

      try {
        // Set window.AL_BUSINESS_CHAT_API to a server endpoint when a backend is available.
        const endpoint = window.AL_BUSINESS_CHAT_API;
        let reply;
        if (typeof endpoint === "string" && endpoint.trim()) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
          });
          if (!response.ok) throw new Error(`Chat API returned ${response.status}`);
          const data = await response.json();
          if (typeof data.reply !== "string" || !data.reply.trim()) {
            throw new Error("Chat API response must contain a non-empty reply string.");
          }
          reply = data.reply;
          if (chatStatus) chatStatus.textContent = "Backend API-yə qoşulub.";
        } else {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          reply = makeDemoReply(message);
          if (chatStatus) chatStatus.textContent = "Demo çat aktivdir. Server tərəfli AI qoşulmayıb.";
        }
        addChatMessage("assistant", reply);
      } catch (error) {
        addChatMessage("assistant", "Mesaj göndərilə bilmədi. Backend/API ünvanını və server bağlantısını yoxlayın.");
        if (chatStatus) chatStatus.textContent = "Backend bağlantısında xəta baş verdi.";
        console.error("Chat request failed:", error);
      } finally {
        if (sendChatBtn) sendChatBtn.disabled = false;
        chatInput.focus();
      }
    });
  }
});
