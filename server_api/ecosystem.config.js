module.exports = {
  apps: [
    {
      name: 'tipitaka-api',
      script: 'server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'warn',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5000,
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
