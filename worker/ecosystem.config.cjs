// PM2 process definition for the Fry Guys WhatsApp worker.
//
// This file is safe to commit: it contains no secrets. All real
// credentials/config come from the worker's own `.env` (git-ignored) via
// `dotenv/config`, which `src/config.ts` already loads.
//
// Usage (documented here, NOT executed as part of this prompt):
//   cd worker
//   npm run build
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 logs fryguys-whatsapp-worker

module.exports = {
  apps: [
    {
      name: "fryguys-whatsapp-worker",
      script: "dist/index.js",
      cwd: __dirname,
      // Single instance only - the worker's own overlap-guarded scheduler
      // and atomic DB claim RPCs assume exactly one process. PM2 cluster
      // mode must never be used here.
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      // Restart on crash, but back off if it keeps crashing immediately -
      // a crash-loop against real WhatsApp/OpenAI credentials should page a
      // human, not hammer the provider.
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,
      // Restart if the process leaks past this - whatsapp-web.js/puppeteer
      // sessions are the most likely long-run memory growth source.
      max_memory_restart: "500M",
      // Graceful shutdown: index.ts already handles SIGINT/SIGTERM by
      // stopping the scheduler, closing the inbound listener and
      // disconnecting the WhatsApp provider before exiting - give it real
      // time to do that instead of a hard SIGKILL.
      kill_timeout: 10000,
      listen_timeout: 10000,
      // Timestamped, size-rotated logs. PM2 stamps every line with
      // `log_date_format` - no application-side logging changes needed.
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: "./logs/worker-out.log",
      error_file: "./logs/worker-error.log",
      merge_logs: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
