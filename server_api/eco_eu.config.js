/**
 * PM2 ecosystem config — tuned for the EU production server.
 *
 * Hardware: 4 vCPU / 8 GB RAM / no swap
 * App:      Fastify + better-sqlite3 (read-only) Tipiṭaka API (server.js)
 *
 * Improvements over ecosystem.config.js:
 *   - cluster mode with 4 workers (one per CPU core) instead of 1 fork
 *   - every worker opens its OWN read-only SQLite connection (safe: the DBs
 *     are opened readonly and PRAGMA query_only = 1, and Node's cluster master
 *     shares port 8400 across workers — no reverse-proxy change required)
 *   - bounded V8 heap per worker (--max-old-space-size=1024) so 4 workers
 *     can never exhaust the 8 GB box
 *   - RSS watchdog restarts a worker at 1.28 GB (4 × 1.28 GB = 5.1 GB worst
 *     case, leaving ~2.9 GB headroom for the OS and other services)
 *   - exponential backoff on crash instead of a fixed 1 s restart delay
 *   - 10 s graceful-shutdown window: server.js closes Fastify + SQLite on
 *     SIGINT/SIGTERM, so in-flight requests can drain before SIGKILL
 *   - merged per-type logs under ./logs (one out.log / err.log for all workers)
 *   - restart-loop protection (min_uptime + max_restarts)
 *
 * Usage (file must end in .config.js for PM2 to treat it as an ecosystem file):
 *   pm2 start eco_eu.config.js   # starts/restarts with the new settings
 *   pm2 restart eco_eu.config.js  # rolling reload (zero downtime)
 *   pm2 stop eco_eu.config.js
 *   pm2 status                   # check workers & per-worker memory
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CWD = path.resolve(__dirname);
const LOG_DIR = path.join(CWD, 'logs');

// PM2 will not create the log directory for us; do it at load time.
fs.mkdirSync(LOG_DIR, { recursive: true });

module.exports = {
  apps: [
    {
      name: 'api.tipitakapali.org',
      script: 'server.js',
      cwd: CWD,

      // --- Scaling (4 vCPU) ---
      exec_mode: 'cluster',
      instances: 4, // one worker per CPU core
      // NODE_APP_INSTANCE (0..3) is injected automatically in cluster mode.
      // Give each worker its own sequential id for request/analytics tagging:
      increment_var: 'INSTANCE_SEQ',

      // --- Environment ---
      env: {
        NODE_ENV: 'production',
        PORT: 8400,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'warn',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 8400,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
      },

      // --- Resource protection (8 GB total, ~6 GB currently usable) ---
      max_memory_restart: '1280M', // restart a worker if RSS exceeds 1.28 GB
      node_args: ['--max-old-space-size=1024'], // cap the V8 heap per worker

      // --- Supervision / crash handling ---
      autorestart: true,
      watch: false,
      // Back off on repeated crashes: 100ms -> 200ms -> 400ms ... (capped).
      exp_backoff_restart_delay: 100,
      max_restarts: 16, // give up (and keep the worker down) after 16 fast crashes
      min_uptime: '10s', // under this uptime, a crash counts as a "fast crash"

      // --- Graceful shutdown ---
      // server.js handles SIGINT/SIGTERM: closes Fastify (drains in-flight
      // requests) and the SQLite connections, then exits 0.
      kill_timeout: 10000, // 10s grace before PM2 sends SIGKILL (default is 1.6s)
      listen_timeout: 15000, // don't kill a slow cold-start boot (DB + dictionary warm-up)

      // --- Logging ---
      out_file: path.join(LOG_DIR, 'out.log'),
      error_file: path.join(LOG_DIR, 'err.log'),
      merge_logs: true, // one out/err log for all 4 cluster workers
      time: true, // prefix every line with a timestamp
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};