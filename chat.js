document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("robotChatToggle");
  const panel = document.getElementById("robotChatPanel");
  const form = document.getElementById("robotChatForm");
  const input = document.getElementById("robotChatInput");
  const messages = document.getElementById("robotChatMessages");
  const status = document.getElementById("robotChatStatus");
  const send = document.getElementById("robotChatSend");

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

  if (!form || !input || !messages) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    addMessage("SİZ", message, true);
    input.value = "";

    const apiBase = (window.AL_BUSINESS_API_URL || "").trim().replace(/\/+$/, "");
    if (!apiBase) {
      const error = "Backend qoşulmayıb. Real cavab üçün əvvəlcə Render-də API servisini deploy edib config.js-ə onun HTTPS URL-sini yazmaq lazımdır.";
      addMessage("BAĞLANTI XƏTASI", error);
      status.textContent = "Real agentlərə qoşulmayıb.";
      return;
    }

    send.disabled = true;
    status.textContent = "Agentlər cavab hazırlayır...";
    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Server xətası (${response.status}).`);
      if (Array.isArray(data.agents) && data.agents.length) {
        data.agents.forEach((agent) => addMessage(`${agent.name} · ${agent.role}`, agent.reply));
        if (data.failedAgents?.length) addMessage("XƏBƏRDARLIQ", `Cavab verməyən agentlər: ${data.failedAgents.join(", ")}`);
      } else if (typeof data.reply === "string" && data.reply.trim()) {
        addMessage("AGENTLƏR", data.reply);
      } else {
        throw new Error("Backend-dən düzgün cavab alınmadı.");
      }
      status.textContent = "Agent cavabları alındı.";
    } catch (error) {
      addMessage("BAĞLANTI XƏTASI", error.message || "Backend-ə qoşulmaq mümkün olmadı.");
      status.textContent = "Sorğu alınmadı; server bağlantısını yoxlayın.";
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
});
