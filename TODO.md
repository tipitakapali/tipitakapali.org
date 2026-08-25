# Production Deployment Checklist: Frontend Cache Re-Enabling

## Current Cache Status
- **Server HTTP Caching (`server_api/server.js`)**: **ENABLED** (`ENABLE_HTTP_CACHE = true`)
  - 1-Year Immutable Caching for canonical books, chapters, TOC, MAT, and precomputed text.
  - 24-Hour / 7-Day stale-while-revalidate for search and dictionary queries.
- **Server Dictionary In-Memory LRU Cache (`server_api/dictEngine.js`)**: **ENABLED** (`ENABLE_DICT_CACHE = true`)
  - Fast in-memory cache for repeated dictionary lookups (< 0.01ms).
- **Frontend / Client-Side API Caching (`services/api.js`)**: **DISABLED** (`ENABLE_CLIENT_CACHE = false`)
  - Disabled during active UI development so that all components, views, and dictionary features fetch live without holding stale client memory or localStorage data.

---

## Final Step Before Public Production Release

When ready to deploy publicly:

1. **Enable Client-Side Cache in `web_app_next/services/api.js`**:
   - Change `ENABLE_CLIENT_CACHE` from `false` to `true`:
     ```javascript
     // Set to true for public production deployment
     export const ENABLE_CLIENT_CACHE = true;
     ```
   - **What this enables**:
     - Client request deduplication (`pendingRequests` Map)
     - In-memory client cache (`cachedFetch`)
     - Browser `localStorage` caching for instant 0ms app boot (`tipitaka_tree_cache_v4`, `tipitaka_books_cache_v1`).

2. **Run Production Build & Verification**:
   ```bash
   cd web_app_next
   npm run build
   ```
