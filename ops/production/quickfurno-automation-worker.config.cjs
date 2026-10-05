const { isAbsolute } = require("node:path");

const envFile = process.env.QF_ENV_FILE?.trim();
if (!envFile || !isAbsolute(envFile)) {
  throw new Error("QF_ENV_FILE must be an absolute external production env file");
}

module.exports = {
  apps: [{
    name: "quickfurno-automation-worker",
    cwd: "/var/www/quickfurno-marketplace",
    script: "dist/automation-worker.mjs",
    interpreter: "node",
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
    kill_timeout: 15000,
    restart_delay: 3000,
    env: {
      NODE_ENV: "production",
      QF_RUNTIME_ENV: "production",
      QF_CONFIG_SCHEMA_VERSION: "1",
      QF_SERVICE_ID: "quickfurno.automation-worker",
      QF_ENV_FILE: envFile,
    },
  }],
};
