module.exports = {
  apps: [{
    name: "al-business-agent-api",
    script: "server.js",
    cwd: "./backend",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    env: { NODE_ENV: "production", PORT: 3000, HOST: "127.0.0.1" },
    time: true
  }]
};
