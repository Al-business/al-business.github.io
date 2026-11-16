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

  const logPanel = document.querySelector(".log-panel");
  const appendLog = (agent, text) => {
    if (!logPanel) return;
    const entry = document.createElement("div");
    entry.className = "log-entry";
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = agent;
    const message = document.createElement("span");
    message.className = "log-message";
    message.textContent = text;
    entry.append(time, name, message);
    logPanel.prepend(entry);
  };

  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatMessages = document.getElementById("chatMessages");
  const chatStatus = document.getElementById("chatStatus");
  const sendButton = document.getElementById("sendChatBtn");
  const apiBase = (window.AL_BUSINESS_API_URL || "").replace(/\/+$/, "");

  const addChatMessage = (role, text, label = "") => {
    if (!chatMessages) return;
    const message = document.createElement("div");
    message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = label || (role === "user" ? "SİZ" : "ASSISTANT");
    const content = document.createElement("p");
    content.textContent = text;
    message.append(name, content);
    chatMessages.append(message);
    message.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const showError = (text) => {
    addChatMessage("assistant", text);
    if (chatStatus) chatStatus.textContent = "Backend bağlantısı uğursuz oldu. Server/API konfiqurasiyasını yoxlayın.";
  };

  async function submitTask(message, source) {
    if (!apiBase) {
      const error = "Backend ünvanı təyin edilməyib. config.js faylında AL_BUSINESS_API_URL dəyərini qurun.";
      if (source === "chat") showError(error);
      else appendLog("XƏTA", error);
      return;
    }
    const button = source === "chat" ? sendButton : document.getElementById("launchBtn");
    if (button) button.disabled = true;
    if (source === "chat" && chatStatus) chatStatus.textContent = "Altı agent tapşırığı emal edir...";
    if (source === "workflow") appendLog("SYSTEM", "Tapşırıq real agent backend-inə göndərildi.");

    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Server xətası (${response.status}).`);
      if (!Array.isArray(data.agents) || data.agents.length === 0) {
        throw new Error("Backend cavabında agent nəticələri yoxdur.");
      }
      if (source === "chat") {
        data.agents.forEach((agent) => addChatMessage("assistant", agent.reply, `${agent.name} · ${agent.role}`));
        if (data.failedAgents?.length) {
          addChatMessage("assistant", `Cavab verə bilməyən agentlər: ${data.failedAgents.join(", ")}.`);
        }
        if (chatStatus) chatStatus.textContent = `${data.agents.length} agent cavab verdi.`;
      } else {
        data.agents.forEach((agent) => appendLog(agent.name, agent.reply));
        if (data.failedAgents?.length) appendLog("XƏBƏRDARLIQ", `Cavab vermədi: ${data.failedAgents.join(", ")}`);
        appendLog("SYSTEM", "Agentlərin cavabları tamamlandı.");
      }
    } catch (error) {
      if (source === "chat") showError(error.message || "Backend-ə qoşulmaq mümkün olmadı.");
      else appendLog("XƏTA", error.message || "Backend-ə qoşulmaq mümkün olmadı.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  if (chatForm && chatInput) {
    chatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = chatInput.value.trim();
      if (!message) return;
      addChatMessage("user", message);
      chatInput.value = "";
      await submitTask(message, "chat");
      chatInput.focus();
    });
  }

  const taskInput = document.getElementById("taskInput");
  const launchButton = document.getElementById("launchBtn");
  const resetButton = document.getElementById("resetBtn");
  if (launchButton && taskInput) {
    launchButton.addEventListener("click", () => {
      const task = taskInput.value.trim();
      if (!task) return taskInput.focus();
      submitTask(task, "workflow");
    });
  }
  if (resetButton && taskInput) {
    resetButton.addEventListener("click", () => {
      taskInput.value = "";
      taskInput.focus();
      if (logPanel) {
        logPanel.replaceChildren();
        appendLog("SYSTEM", "Qeydlər təmizləndi.");
      }
    });
  }
});
