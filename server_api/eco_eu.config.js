/**
 * PM2 ecosystem config — tuned for the 2 vCPU / 4 GB RAM VPS.
 *
 * Hardware: 2 vCPU / 4 GB RAM / no swap
 * App:      Fastify + better-sqlite3 (read-only) Tipiṭaka API (server.js)
 *
 * Sizing & Resource Allocation:
 *   - cluster mode with 2 workers (one per CPU core)
 *   - each worker opens its own read-only SQLite connection (PRAGMA query_only = 1)
 *   - bounded V8 heap per worker (--max-old-space-size=1024)
 *   - RSS watchdog restarts a worker at 1.28 GB (2 × 1.28 GB = 2.56 GB worst
 *     case, leaving ~1.44 GB headroom for the OS, buffers, and kernel page cache)
 *   - exponential backoff on crash instead of a fixed 1 s restart delay
 *   - 10 s graceful-shutdown window for connection and query draining
 *   - merged per-type logs under ./logs
 *   - restart-loop protection (min_uptime + max_restarts)
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 reload ecosystem.config.js   # zero-downtime rolling reload
 *   pm2 status
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CWD = path.resolve(__dirname);
const LOG_DIR = path.join(CWD, 'logs');

// Ensure log directory exists at load time
fs.mkdirSync(LOG_DIR, { recursive: true });

module.exports = {
  apps: [
    {
      name: 'api.tipitakapali.org',
      script: 'server.js',
      cwd: CWD,

      // --- Scaling (2 vCPU) ---
      exec_mode: 'cluster',
      instances: 2, // 1 worker per CPU core
      increment_var: 'INSTANCE_SEQ',

      // --- Environment ---
      env: {
        NODE_ENV: 'production',
        PORT: 8400,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'warn',
        IPINFO_TOKEN: '20c2565b67da0e',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 8400,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
      },

      // --- Resource Protection (4 GB total) ---
      max_memory_restart: '1280M', // restart worker if RSS exceeds 1.28 GB
      node_args: ['--max-old-space-size=1024'], // cap V8 heap per worker at 1 GB

      // --- Supervision / Crash Handling ---
      autorestart: true,
      watch: false,
      exp_backoff_restart_delay: 100,
      max_restarts: 16,
      min_uptime: '10s',

      // --- Graceful Shutdown & Startup ---
      kill_timeout: 10000, // 10s grace period for in-flight requests
      listen_timeout: 15000, // cold-start allowance for SQLite warming

      // --- Logging ---
      out_file: path.join(LOG_DIR, 'out.log'),
      error_file: path.join(LOG_DIR, 'err.log'),
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};



