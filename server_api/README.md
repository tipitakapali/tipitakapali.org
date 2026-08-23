# Chaṭṭha Saṅgāyana Tipiṭaka — Fastify Node.js Backend API

Ultra-fast, production-ready REST API built with **Node.js 24**, **Fastify**, and **native SQLite C++ engine (`node:sqlite`)** designed to serve 217 Tipiṭaka books and 520,000+ paragraphs with sub-millisecond latency.

---

## Performance Highlights

- **Fastify Framework**: Extremely low-overhead HTTP engine with built-in compression (`@fastify/compress`) and CORS (`@fastify/cors`).
- **Zero-Overhead Native SQLite**: Uses native synchronous C++ SQLite statements directly in the V8 process without IPC or network latency.
- **In-Memory Book HTML Cache**: Renders canonical Tipitaka XML once, and serves subsequent requests in **< 0.5ms**.
- **PM2 Ready**: Includes `ecosystem.config.js` for zero-downtime cluster mode, auto-restarts, and monitoring.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | API service status and endpoint directory |
| `GET` | `/api/tree` | 4 authentic top-level categories navigation tree |
| `GET` | `/api/books` | List of all 217 books with chapter counts and nikayas |
| `GET` | `/api/book/:code` | Full book text, chapter dividers, and anchor tags |
| `GET` | `/api/search?q=...` | Full-text FTS5 search with keyword snippets and total matches |
| `GET` | `/api/health` | Memory usage, uptime, and cached book metrics |

---

## Running the Server

### Standard Run (Node.js)
```bash
# Start server on port 5000
npm start

# Or in development mode with auto-reload
npm run dev
```

### Running with PM2 (Production Process Manager)
```bash
# Start cluster with PM2
pm2 start ecosystem.config.js

# View live status and metrics
pm2 status

# View live logs
pm2 logs tipitaka-api

# Stop / Restart
pm2 restart tipitaka-api
pm2 stop tipitaka-api
```
