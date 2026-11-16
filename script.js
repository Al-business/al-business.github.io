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

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const taskInput = document.getElementById("taskInput");
  const runBtn = document.getElementById("runWorkflowBtn");
  const launchBtn = document.getElementById("launchBtn");
  const resetBtn = document.getElementById("resetBtn");
  const logPanel = document.querySelector(".log-panel");
  const apiBase = (window.AL_BUSINESS_API_URL || "http://localhost:3000").replace(/\/+$/, "");

  const appendLog = (agent, message) => {
    if (!logPanel) return;
    const entry = document.createElement("div");
    entry.className = "log-entry";
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    entry.innerHTML = `
      <span class="time">${time}</span>
      <span class="agent-name">${agent}</span>
      <span class="log-message">${message}</span>
    `;
    logPanel.prepend(entry);
  };

  async function pollJob(jobId) {
    while (true) {
      const response = await fetch(`${apiBase}/api/agents/jobs/${jobId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Job status request failed (${response.status})`);
      }

      if (Array.isArray(data.agents) && data.agents.length) {
        data.agents.forEach((agent) => {
          appendLog(agent.name, agent.reply);
        });
      }

      if (data.status === "completed") {
        appendLog("SYSTEM", `Task #${jobId} completed successfully.`);
        return;
      }

      if (data.status === "failed") {
        appendLog("SYSTEM", `Task #${jobId} failed: ${data.lastError || "Unknown error"}`);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  async function runAgentWorkflow() {
    if (!taskInput) return;
    const message = taskInput.value.trim();
    if (!message) {
      taskInput.focus();
      return;
    }

    appendLog("SYSTEM", "Sending task to the agent worker...");

    try {
      const response = await fetch(`${apiBase}/api/agents/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Server error (${response.status})`);
      }

      appendLog("SYSTEM", `Task queued with ID #${data.id}. Waiting for worker results...`);
      await pollJob(data.id);
    } catch (error) {
      appendLog("ERROR", error.message || "Agent API failed.");
    }
  }

  if (runBtn) runBtn.addEventListener("click", runAgentWorkflow);
  if (launchBtn) launchBtn.addEventListener("click", runAgentWorkflow);

  if (resetBtn && taskInput) {
    resetBtn.addEventListener("click", () => {
      taskInput.value = "Build a modern e-commerce platform with a FastAPI backend, user and product tables, and Docker deployment.";
      if (logPanel) {
        logPanel.innerHTML = `
          <div class="log-entry">
            <span class="time">--:--</span>
            <span class="agent-name">SYSTEM</span>
            <span class="log-message">Workflow reset and waiting for a new task.</span>
          </div>
        `;
      }
    });
  }
});
