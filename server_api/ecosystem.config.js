module.exports = {
  apps: [
    {
      name: 'api.tipitakapali.org',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
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
      max_memory_restart: '600M',
      autorestart: true,
      restart_delay: 1000,
      watch: false,
      merge_logs: true,
      time: true,
    },
  ],
};
