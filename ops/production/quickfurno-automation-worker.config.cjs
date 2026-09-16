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
      QF_ENV_FILE: ".env.production",
    },
  }],
};
