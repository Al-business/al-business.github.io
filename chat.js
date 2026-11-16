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

  async function pollJob(id) {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await fetch(`${apiBase}/api/agents/jobs/${encodeURIComponent(id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Status xətası (${response.status}).`);
      if (Array.isArray(data.agents)) {
        data.agents.forEach((agent) => {
          const key = `${id}:${agent.name}`;
          if (!window.__chatSeenResults) window.__chatSeenResults = new Set();
          if (!window.__chatSeenResults.has(key)) {
            window.__chatSeenResults.add(key);
            addMessage(`${agent.name} · ${agent.role}`, agent.reply);
          }
        });
      }
      if (data.status === "completed") {
        status.textContent = `Tapşırıq #${id} tamamlandı; ${data.agents.length} agent cavab verdi.`;
        return;
      }
      if (data.status === "failed") throw new Error(data.last_error || "Agent tapşırığı retry limitinə çatdı.");
      status.textContent = data.status === "running"
        ? `Tapşırıq #${id} icradadır (${data.attempts} cəhd)...`
        : `Tapşırıq #${id} növbədədir.`;
    }
  }

  if (!form || !input || !messages) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    addMessage("SİZ", message, true);
    input.value = "";

    if (!apiBase) {
      addMessage("BAĞLANTI XƏTASI", "Backend URL təyin edilməyib; real agent tapşırığı göndərilə bilmədi.");
      status.textContent = "Real agentlərə qoşulmayıb.";
      return;
    }

    send.disabled = true;
    status.textContent = "Tapşırıq davamlı agent növbəsinə göndərilir...";
    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Server xətası (${response.status}).`);
      status.textContent = `Tapşırıq #${data.id} növbəyə yazıldı.`;
      await pollJob(data.id);
    } catch (error) {
      addMessage("BAĞLANTI / İCRA XƏTASI", error.message || "Backend-ə qoşulmaq mümkün olmadı.");
      status.textContent = "Tapşırıq tamamlanmadı; status serverdə saxlanılır və dəstək varsa retry ediləcək.";
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
});
