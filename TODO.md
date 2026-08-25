# Production Deployment Checklist: Re-Enabling Caches

During active development, all caching layers (client memory cache, browser localStorage cache, Fastify HTTP response caching headers, and backend SQLite dictionary LRU caches) have been disabled so that all code, database, and style changes reflect immediately without stale data.

Before deploying the app to public production, follow this checklist to re-enable caching for maximum performance and sub-millisecond response times.

---

## 1. Client-Side API Caching (`web_app_next/services/api.js`)

- **File**: `services/api.js`
- **Change**: Change `ENABLE_CLIENT_CACHE` from `false` to `true`:
  ```javascript
  // Set to true for production deployment
  export const ENABLE_CLIENT_CACHE = true;
  ```
- **What this enables**:
  - Request deduplication (`pendingRequests` Map)
  - In-memory client cache (`cachedFetch`)
  - Browser `localStorage` caching for the navigation tree (`tipitaka_tree_cache_v4`) and books list (`tipitaka_books_cache_v1`) for instant 0ms app boot.

---

## 2. Server API HTTP Cache-Control Headers (`web_app_next/server_api/server.js`)

- **File**: `server_api/server.js`
- **Change**: Change `ENABLE_HTTP_CACHE` from `false` to `true`:
  ```javascript
  // Set to true for production deployment
  const ENABLE_HTTP_CACHE = true;
  ```
- **What this enables**:
  - 1-Year Immutable Caching for static canonical texts (`/api/tree`, `/api/books`, `/api/book/:code`, `/api/book/:code/chapter/:chapterIndex`, `/api/book/:code/toc`, `/api/book/:code/xml`, `/api/book/:code/mat`, `/api/mat`).
  - 24-Hour / 7-Day stale-while-revalidate caching for dictionary queries (`/api/dict/lookup`, `/api/dict/inf`, `/api/search`).

---

## 3. Server In-Memory Dictionary LRU Cache (`web_app_next/server_api/dictEngine.js`)

- **File**: `server_api/dictEngine.js`
- **Change**: Change `ENABLE_DICT_CACHE` from `false` to `true`:
  ```javascript
  // Set to true for production deployment
  const ENABLE_DICT_CACHE = true;
  ```
- **What this enables**:
  - Bounded in-memory LRU cache (`dictCache`, up to 3,000 entries) for `< 0.01ms` dictionary lookups on repeated or popular queries.

---

## 4. Production Build & Verification

1. Run the production build:
   ```bash
   cd web_app_next
   npm run build
   ```
2. Restart the API server worker cluster:
   ```bash
   kill -HUP $(pgrep -f "server_api/server.js") || node server_api/server.js &
   ```
3. Test a dictionary lookup via HTTP to verify `Cache-Control` header is active:
   ```bash
   curl -I "http://127.0.0.1:5000/api/dict/lookup?w=buddha"
   # Should return: Cache-Control: public, max-age=86400, stale-while-revalidate=604800
   ```
