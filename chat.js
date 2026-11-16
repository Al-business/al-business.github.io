document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("robotChatToggle");
  const panel = document.getElementById("robotChatPanel");
  const form = document.getElementById("robotChatForm");
  const input = document.getElementById("robotChatInput");
  const messages = document.getElementById("robotChatMessages");
  const status = document.getElementById("robotChatStatus");
  const send = document.getElementById("robotChatSend");
  const apiBase = (window.AL_BUSINESS_API_URL || "").trim().replace(/\/+$/, "");

  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) input?.focus();
    });
  }

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
    link.href = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
    link.download = file.path.split("/").pop();
    link.textContent = "Faylı endir";
    link.className = "btn btn-secondary";
    item.append(name, preview, link);
    messages.append(item);
  }

  const modeWrap = document.createElement("div");
  modeWrap.className = "form-row";
  const modeLabel = document.createElement("label");
  modeLabel.className = "input-label";
  modeLabel.htmlFor = "agentMode";
  modeLabel.textContent = "Agent rejimi";

  const mode = document.createElement("select");
  mode.id = "agentMode";
  mode.className = "agent-mode-select";
  [
    ["chat", "Agentlərlə danış"],
    ["build", "Layihə yarat və sintaksisi yoxla"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    mode.append(option);
  });

  if (form) {
    form.insertBefore(modeWrap, form.firstChild);
    modeWrap.append(modeLabel, mode);
  }

  async function pollJob(id) {
    const deadline = Date.now() + 180_000;
    const seen = new Set();
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await fetch(`${apiBase}/api/agents/jobs/${encodeURIComponent(id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Status xətası (${response.status}).`);

      for (const agent of data.agents || []) {
        if (!seen.has(agent.name)) {
          seen.add(agent.name);
          addMessage(`${agent.name} · ${agent.role}`, agent.reply);
        }
      }

      if (data.status === "completed") {
        if (data.failedAgents?.length) addMessage("XƏBƏRDARLIQ", `Cavab verməyən agentlər: ${data.failedAgents.join(", ")}`);
        status.textContent = `Tapşırıq #${id} tamamlandı.`;
        return;
      }

      if (data.status === "failed") {
        throw new Error(data.lastError || "Agent tapşırığı uğursuz oldu.");
      }

      status.textContent = data.status === "running" ? `Tapşırıq #${id} işləyir...` : `Tapşırıq #${id} növbədədir...`;
    }

    throw new Error("Gözləmə müddəti bitdi; yenidən cəhd edin.");
  }

  if (!form || !input || !messages) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    addMessage("SİZ", message, true);
    input.value = "";

    if (!apiBase) {
      addMessage("BAĞLANTI XƏTASI", "Backend URL təyin edilməyib. config.js-də API URL-ni yazın.");
      status.textContent = "Backend konfiqurasiyası yoxdur.";
      return;
    }

    send.disabled = true;
    try {
      if (mode.value === "build") {
        status.textContent = "Agent layihə faylları hazırlayır və sandbox-da sintaksisi yoxlayır...";
        const response = await fetch(`${apiBase}/api/agent/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Server xətası (${response.status}).`);

        const checkText = data.validation?.status === "passed"
          ? "Sandbox-da JS/Python sintaksis yoxlaması keçdi. Bu, tətbiqin tam test edildiyini göstərmir."
          : data.validation?.status === "not-configured"
            ? "Sandbox konfiqurasiya olunmayıb; sintaksis yoxlaması edilmədi."
            : data.validation?.status === "no-supported-files"
              ? "Yoxlanacaq JS/Python faylı yaratılmadı."
              : "Sandbox yoxlaması uğursuz və ya baş tutmadı; faylları tam işlək saymayın.";

        addMessage("AGENT · XÜLASƏ", `${data.summary}\n\n${checkText}`);
        (data.files || []).forEach(addDownload);
        status.textContent = `${(data.files || []).length} fayl hazırdır; validation: ${data.validation?.status || "unknown"}.`;
      } else {
        status.textContent = "Tapşırıq agent növbəsinə göndərilir...";
        const response = await fetch(`${apiBase}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
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
