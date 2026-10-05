const { isAbsolute } = require("node:path");

const envFile = process.env.QF_ENV_FILE?.trim();
if (!envFile || !isAbsolute(envFile)) {
  throw new Error("QF_ENV_FILE must be an absolute external production env file");
}

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
      QF_RUNTIME_ENV: "production",
      QF_CONFIG_SCHEMA_VERSION: "1",
      QF_SERVICE_ID: "quickfurno.conversation-transport",
      QF_ENV_FILE: envFile,
      QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS: "1000",
      QF_CONVERSATION_TRANSPORT_BUSY_POLL_MS: "25",
      QF_CONVERSATION_TRANSPORT_MAX_DRAIN: "50",
    },
  }],
};
