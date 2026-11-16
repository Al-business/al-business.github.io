document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("robotChatToggle");
  const panel = document.getElementById("robotChatPanel");
  const form = document.getElementById("robotChatForm");
  const input = document.getElementById("robotChatInput");
  const messages = document.getElementById("robotChatMessages");
  const status = document.getElementById("robotChatStatus");
  const send = document.getElementById("robotChatSend");
  const apiBase = (window.AL_BUSINESS_API_URL || "").trim().replace(/\/+$/, "");

  toggle?.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) input?.focus();
  });
  if (!form || !input || !messages) return;

  // Add a project-builder mode without changing the existing dashboard markup.
  const modeLabel = document.createElement("label");
  modeLabel.className = "input-label";
  modeLabel.htmlFor = "agentMode";
  modeLabel.textContent = "Agent rejimi";
  const mode = document.createElement("select");
  mode.id = "agentMode";
  mode.className = "agent-mode-select";
  [["chat", "Agentlərlə danış"], ["build", "Layihə faylları yarat"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    mode.append(option);
  });
  form.insertBefore(mode, form.firstChild);
  form.insertBefore(modeLabel, mode);

  function addMessage(label, text, isUser = false) {
    const item = document.createElement("div");
    item.className = `robot-chat-message${isUser ? " user-message" : ""}`;
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = label;
    const body = document.createElement("p");
    body.textContent = text;
    item.append(name, body);
    messages.append(item);
    item.scrollIntoView({ block: "nearest" });
    return item;
  }

  function addDownload(file) {
    const item = document.createElement("div");
    item.className = "robot-chat-message generated-file";
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = file.path;
    const preview = document.createElement("pre");
    preview.textContent = file.content;
    const link = document.createElement("a");
    link.className = "btn btn-secondary";
    link.textContent = "Faylı endir";
    link.download = file.path.split("/").pop();
    link.href = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
    link.addEventListener("click", () => setTimeout(() => URL.revokeObjectURL(link.href), 60_000), { once: true });
    item.append(name, preview, link);
    messages.append(item);
  }

  async function pollJob(id) {
    const deadline = Date.now() + 180_000;
    const shown = new Set();
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const response = await fetch(`${apiBase}/api/agents/jobs/${encodeURIComponent(id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Status sorğusu xətası (${response.status}).`);
      for (const agent of data.agents || []) {
        if (shown.has(agent.name)) continue;
        shown.add(agent.name);
        addMessage(`${agent.name} · ${agent.role}`, agent.reply);
      }
      if (data.status === "completed") {
        if (data.failedAgents?.length) addMessage("XƏBƏRDARLIQ", `Cavab verməyən agentlər: ${data.failedAgents.join(", ")}`);
        status.textContent = `Tapşırıq #${id} tamamlandı.`;
        return;
      }
      if (data.status === "failed") throw new Error(data.lastError || "Agent tapşırığı uğursuz oldu.");
      status.textContent = data.status === "running" ? `Tapşırıq #${id} işləyir...` : `Tapşırıq #${id} növbədədir.`;
    }
    throw new Error("Gözləmə müddəti bitdi. Sonra yenidən yoxlayın.");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    addMessage("SİZ", message, true);
    input.value = "";
    if (!apiBase) {
      addMessage("BAĞLANTI XƏTASI", "Backend URL təyin edilməyib.");
      status.textContent = "Backend konfiqurasiyası yoxdur.";
      return;
    }

    send.disabled = true;
    try {
      if (mode.value === "build") {
        status.textContent = "Agent layihə fayllarını yaradır...";
        const response = await fetch(`${apiBase}/api/agent/build`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Agent xətası (${response.status}).`);
        addMessage("AGENT · XÜLASƏ", `${data.summary}\n\nFayllar icra edilməyib; endirib özünüz yoxlayın.`);
        (data.files || []).forEach(addDownload);
        status.textContent = `${data.files?.length || 0} fayl yaradıldı; heç bir kod serverdə icra edilmədi.`;
      } else {
        status.textContent = "Tapşırıq agent növbəsinə göndərilir...";
        const response = await fetch(`${apiBase}/api/chat`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Server xətası (${response.status}).`);
        await pollJob(data.id);
      }
    } catch (error) {
      addMessage("XƏTA", error.message || "Sorğu alınmadı.");
      status.textContent = "Tapşırıq tamamlanmadı.";
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
});
