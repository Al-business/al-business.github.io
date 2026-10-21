document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

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

  const runBtn = document.getElementById("runWorkflowBtn");
  const launchBtn = document.getElementById("launchBtn");
  const resetBtn = document.getElementById("resetBtn");
  const taskInput = document.getElementById("taskInput");
  const logPanel = document.querySelector(".log-panel");

  const appendLog = (agent, message) => {
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

  const runWorkflow = () => {
    if (!taskInput) return;
    const value = taskInput.value.trim();
    if (!value) {
      taskInput.focus();
      return;
    }

    const steps = [
      ["CEO", "İş hedefi ve strateji planı hazırlandı."],
      ["CODER", "Backend ve API yapısı oluşturuluyor."],
      ["DB", "Veri modeli ve SQL şemaları hazırlanıyor."],
      ["DEVOPS", "Docker ve deployment dosyaları oluşturuluyor."],
      ["QA", "Doğrulama ve test akışı çalıştırıldı."],
      ["DEPLOY", "Yayım adımı başlatıldı."]
    ];

    steps.forEach(([agent, message], index) => {
      setTimeout(() => appendLog(agent, message), index * 350);
    });
  };

  if (runBtn) {
    runBtn.addEventListener("click", runWorkflow);
  }

  if (launchBtn) {
    launchBtn.addEventListener("click", runWorkflow);
  }

  if (resetBtn && taskInput) {
    resetBtn.addEventListener("click", () => {
      taskInput.value = "Alibaba tarzı e-ticaret platformu kur: FastAPI backend, ürün ve kullanıcı tabloları, Dockerfile ve docker-compose.yml.";
      if (logPanel) {
        logPanel.innerHTML = `
          <div class="log-entry">
            <span class="time">--:--</span>
            <span class="agent-name">SYSTEM</span>
            <span class="log-message">İş akışı sıfırlandı ve bekleme moduna alındı.</span>
          </div>
        `;
      }
    });
  }
});
