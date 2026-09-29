module.exports = {
  apps: [{
    name: "quickfurno-conversation-transport",
    cwd: "/var/www/quickfurno-marketplace",
    script: "dist/conversation-transport-worker.mjs",
    interpreter: "node",
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
    kill_timeout: 10000,
    restart_delay: 1000,
    env: {
      NODE_ENV: "production",
      QF_ENV_FILE: ".env.local",
      QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS: "100",
      QF_CONVERSATION_TRANSPORT_BUSY_POLL_MS: "10",
      QF_CONVERSATION_TRANSPORT_MAX_DRAIN: "50",
    },
  }],
};
