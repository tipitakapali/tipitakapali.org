'use strict';

// logEngine.js — visitor / request logger for the Tipiṭaka API.
//
// Adapted from ref/api.tipitakapali.org-main/appRouteHandler.js + dbOpener.js:
//   - saveLogToDatabase(reqBody, ip, logType)  -> INSERT INTO logs (logs.db)
//   - GET /log?filter=day|week|hour&timezone=... -> live HTML log viewer
//
// The heavy work (ipinfo.io lookup + SQLite INSERT) is deliberately scheduled with
// setImmediate() by logAsync() so it NEVER blocks the request/response path.
// logs.db is a separate writable database (all other DBs are opened read-only).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Allow operators to point the visitor log elsewhere (default: next to server.js,
// same layout as the reference api.tipitakapali.org which keeps logs.db at root).
const LOGS_DB_PATH = process.env.LOGS_DB_PATH || path.join(__dirname, 'logs.db');

let logsDb = null;
let stmtInsert = null;
let stmtPruneBatch = null;
let pruneTimer = null;

const ipCache = new Map();
const IP_CACHE_MAX = 8000;
const MAX_LOG_DATA = 4000; // truncate huge bodies (e.g. AI chat) so logs.db stays lean
const IPINFO_FETCH_TIMEOUT_MS = 4000;

const DEFAULT_LOG_LIMIT = 1000;
const MAX_LOG_LIMIT = 10000;
const LIMIT_PRESETS = [100, 500, 1000, 2000, 5000];
const DEFAULT_RETENTION_DAYS = 14;
const PRUNE_BATCH_SIZE = 5000;
const PRUNE_INITIAL_DELAY_MS = 10 * 1000;
const PRUNE_BURST_DELAY_MS = 2 * 1000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FILTER_WINDOWS_MS = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

function getRetentionDays() {
  const raw = process.env.LOGS_RETENTION_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_RETENTION_DAYS;
}

function pruneOldLogs(retentionDays = getRetentionDays(), batchSize = PRUNE_BATCH_SIZE) {
  if (!logsDb || !stmtPruneBatch || !(retentionDays > 0)) return 0;
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const info = stmtPruneBatch.run(cutoffIso, batchSize);
    return info.changes || 0;
  } catch (err) {
    console.warn('[LogEngine] Retention prune warning:', err.message);
    return 0;
  }
}

function scheduleRetentionPrune(delayMs = PRUNE_INITIAL_DELAY_MS) {
  if (pruneTimer) {
    clearTimeout(pruneTimer);
    pruneTimer = null;
  }
  pruneTimer = setTimeout(() => {
    pruneTimer = null;
    if (!logsDb) return;
    const days = getRetentionDays();
    if (!(days > 0)) return;
    const deleted = pruneOldLogs(days, PRUNE_BATCH_SIZE);
    if (deleted > 0) {
      console.log(`[LogEngine] Pruned ${deleted} log rows older than ${days}d`);
    }
    const nextDelay = deleted >= PRUNE_BATCH_SIZE ? PRUNE_BURST_DELAY_MS : PRUNE_INTERVAL_MS;
    scheduleRetentionPrune(nextDelay);
  }, delayMs);
  if (typeof pruneTimer.unref === 'function') {
    pruneTimer.unref();
  }
}

function initLogEngine(dbPath = null, options = {}) {
  if (logsDb) return logsDb;
  const resolvedPath = dbPath || process.env.LOGS_DB_PATH || LOGS_DB_PATH;
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  logsDb = new Database(resolvedPath); // writable by design
  logsDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 15000;
  `);
  logsDb.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs (timestamp DESC);
  `);
  stmtInsert = logsDb.prepare('INSERT INTO logs (timestamp, type, data) VALUES (?, ?, ?)');
  stmtPruneBatch = logsDb.prepare(
    'DELETE FROM logs WHERE id IN (SELECT id FROM logs WHERE timestamp < ? ORDER BY timestamp ASC LIMIT ?)'
  );
  console.log(`[LogEngine] Visitor logs enabled at: ${resolvedPath}`);

  const isPrimaryWorker =
    process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === '0';
  if (options?.enablePruneTimer !== false && getRetentionDays() > 0 && isPrimaryWorker) {
    scheduleRetentionPrune();
  }

  return logsDb;
}

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function createTimeZoneFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return null;
  }
}

function convertToTimeZone(utcTimestamp, timeZone, formatter = null) {
  const date = new Date(utcTimestamp);
  if (Number.isNaN(date.getTime())) return String(utcTimestamp);
  const activeFormatter = formatter || new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return activeFormatter.format(date);
}

// ipinfo.io lookup with an in-memory cache (same cache pattern as the reference).
async function getIpInfo(ipAddress = null) {
  const cacheKey = ipAddress || 'default';
  if (ipCache.has(cacheKey)) return ipCache.get(cacheKey);

  let url = 'https://ipinfo.io/json';
  const token = process.env.IPINFO_TOKEN || '';
  if (ipAddress) url = `https://ipinfo.io/${ipAddress}/json`;
  if (token) url += `?token=${token}`;

  try {
    const response = await Promise.race([
      fetch(url),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ipinfo.io timeout')), IPINFO_FETCH_TIMEOUT_MS)
      ),
    ]);
    const jsonResponse = await response.json();
    const ipInfo = {
      city: jsonResponse.city || 'unknown',
      country: jsonResponse.country || 'unknown',
    };
    ipCache.set(cacheKey, ipInfo);
    if (ipCache.size > IP_CACHE_MAX) {
      ipCache.delete(ipCache.keys().next().value);
    }
    return ipInfo;
  } catch (error) {
    console.error('[LogEngine] Error fetching IP info:', error.message || error);
    return { city: 'unknown', country: 'unknown' };
  }
}

async function saveLogToDatabase(reqBody, ip = '127.0.0.1', logType = 'OK') {
  if (!logsDb) initLogEngine();

  let type = logType === 'OK' ? '' : ` ${logType}`;
  let data;
  try {
    data = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
  } catch (_) {
    data = String(reqBody);
  }
  if (data.length > MAX_LOG_DATA) data = `${data.slice(0, MAX_LOG_DATA)}…[truncated]`;

  try {
    const ipInfo = await getIpInfo(ip);
    const location = `${ipInfo.country}-${ipInfo.city}`;
    stmtInsert.run(getCurrentTimestamp(), location + type, data);
  } catch (err) {
    console.error('[LogEngine] Error saving log to database:', err.message);
  }
}

// Non-blocking entry point — schedule the logging work with setImmediate so the
// request can finish first (this is the pattern from the reference backend:
//   setImmediate(() => saveLogToDatabase(req.body, req.ip, "OK")) )
function logAsync(reqBody, ip = '127.0.0.1', logType = 'OK') {
  setImmediate(() => saveLogToDatabase(reqBody, ip, logType));
}

// The reference interpolates raw request data into the HTML page; escape it here
// so search terms / visitor-supplied strings can never break out of the markup.
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildLogUrl({ filter, timezone, status, limit, page }) {
  const params = new URLSearchParams();
  params.set('filter', filter);
  params.set('timezone', timezone);
  if (status) params.set('status', status);
  if (limit && limit !== DEFAULT_LOG_LIMIT) params.set('limit', String(limit));
  if (page && page > 1) params.set('page', String(page));
  return `/log?${params.toString()}`;
}

function registerLogRoutes(fastify) {
  fastify.get('/log', async (req, reply) => {
    const rawFilter = String(req.query.filter || 'day').trim().toLowerCase();
    const filter = FILTER_WINDOWS_MS[rawFilter] ? rawFilter : 'day';
    const timezone = String(req.query.timezone || 'Asia/Bangkok');
    const rawStatus = String(req.query.status || '').trim().toLowerCase();
    const statusFilter = /^\d{3}$/.test(rawStatus) || rawStatus === 'error' ? rawStatus : '';
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LOG_LIMIT)
        : DEFAULT_LOG_LIMIT;
    const parsedPage = parseInt(req.query.page, 10);
    const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

    const cutoffIso = new Date(Date.now() - FILTER_WINDOWS_MS[filter]).toISOString();
    let whereClause = 'timestamp >= ?';
    const params = [cutoffIso];

    if (statusFilter === 'error') {
      whereClause += " AND type LIKE '% Error'";
    } else if (statusFilter) {
      whereClause += ' AND (data LIKE ? OR data LIKE ?)';
      params.push(`%"status":${statusFilter},%`, `%"status":${statusFilter}}%`);
    }

    try {
      if (!logsDb) initLogEngine();
      const countRow = logsDb
        .prepare(`SELECT COUNT(*) AS total FROM logs WHERE ${whereClause}`)
        .get(...params);
      const totalEvents = countRow ? countRow.total : 0;
      const totalPages = Math.max(1, Math.ceil(totalEvents / limit));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * limit;

      const rows = logsDb
        .prepare(
          `SELECT id, timestamp, type, data FROM logs WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

      const formatter = createTimeZoneFormatter(timezone);
      const logItems = rows.map((row) => {
        let localizedTime;
        try {
          localizedTime = formatter
            ? convertToTimeZone(row.timestamp, timezone, formatter)
            : row.timestamp;
        } catch (_) {
          localizedTime = row.timestamp; // invalid timezone from the URL -> show UTC ISO
        }
        return `<li>[${localizedTime}] (${escapeHtml(row.type)}): ${escapeHtml(row.data)}</li>`;
      });

      const statusPresets = [
        { value: '', label: 'All' },
        { value: '404', label: '404 (Not Found)' },
        { value: 'error', label: 'All Errors (>=400)' },
        { value: '200', label: '200 (OK)' },
        { value: '400', label: '400 (Bad Request)' },
        { value: '500', label: '500 (Server Error)' },
      ];
      if (statusFilter && !statusPresets.some((p) => p.value === statusFilter)) {
        statusPresets.push({ value: statusFilter, label: statusFilter });
      }
      const statusOptionsHtml = statusPresets
        .map(
          (p) =>
            `<option value="${escapeHtml(p.value)}"${p.value === statusFilter ? ' selected' : ''}>${escapeHtml(p.label)}</option>`
        )
        .join('');

      const limitOptions = LIMIT_PRESETS.includes(limit)
        ? LIMIT_PRESETS
        : [...LIMIT_PRESETS, limit].sort((a, b) => a - b);
      const limitOptionsHtml = limitOptions
        .map(
          (n) =>
            `<option value="${n}"${n === limit ? ' selected' : ''}>${n}</option>`
        )
        .join('');

      const statusLabel = statusFilter ? ` (status: ${escapeHtml(statusFilter)})` : '';
      const headingSummary =
        totalEvents === 0
          ? `Showing 0 events${statusLabel} from the past 1 ${escapeHtml(filter.toUpperCase())}.`
          : `Showing ${offset + 1}–${offset + rows.length} of ${totalEvents} events${statusLabel} from the past 1 ${escapeHtml(filter.toUpperCase())} (Page ${page} of ${totalPages}).`;

      const navLink = (label, targetPage, disabled) =>
        disabled
          ? `<span style="color:#888">${label}</span>`
          : `<a href="${escapeHtml(buildLogUrl({ filter, timezone, status: statusFilter, limit, page: targetPage }))}">${label}</a>`;

      const paginationHtml =
        totalPages > 1
          ? `<p class="pagination">${navLink('« First', 1, page <= 1)} | ${navLink('‹ Prev', page - 1, page <= 1)} | <strong>Page ${page} of ${totalPages}</strong> | ${navLink('Next ›', page + 1, page >= totalPages)} | ${navLink('Last »', totalPages, page >= totalPages)}</p>`
          : '';

      const hourHref = escapeHtml(buildLogUrl({ filter: 'hour', timezone, status: statusFilter, limit, page: 1 }));
      const dayHref = escapeHtml(buildLogUrl({ filter: 'day', timezone, status: statusFilter, limit, page: 1 }));
      const weekHref = escapeHtml(buildLogUrl({ filter: 'week', timezone, status: statusFilter, limit, page: 1 }));
      const notFoundHref = escapeHtml(buildLogUrl({ filter, timezone, status: '404', limit, page: 1 }));

      const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tipiṭaka API Dictionary Log</title>
        <script>
          function updateTimezone() {
            const selectedTimezone = document.getElementById("timezoneSelect").value;
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.set("timezone", selectedTimezone);
            window.location.search = urlParams.toString();
          }
          function updateStatus() {
            const selectedStatus = document.getElementById("statusSelect").value;
            const urlParams = new URLSearchParams(window.location.search);
            if (selectedStatus) {
              urlParams.set("status", selectedStatus);
            } else {
              urlParams.delete("status");
            }
            urlParams.delete("page");
            window.location.search = urlParams.toString();
          }
          function updateLimit() {
            const selectedLimit = document.getElementById("limitSelect").value;
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.set("limit", selectedLimit);
            urlParams.delete("page");
            window.location.search = urlParams.toString();
          }
        </script>
      </head>
      <body>
        <p>Filter by:
          <a href="${hourHref}">Hour</a> |
          <a href="${dayHref}">Day</a> |
          <a href="${weekHref}">Week</a> |
          <a href="${notFoundHref}">404 Only</a> |
          <label for="statusSelect">Status:</label>
          <select id="statusSelect" onchange="updateStatus()">${statusOptionsHtml}</select> |
          <label for="limitSelect">Per page:</label>
          <select id="limitSelect" onchange="updateLimit()">${limitOptionsHtml}</select> |
          <label for="timezoneSelect">Select Time Zone:</label>
          <select id="timezoneSelect" onchange="updateTimezone()">
          </select>
        </p>

        <h1>Timestamps are in ${escapeHtml(timezone)}. ${headingSummary}</h1>
        ${paginationHtml}
        <ol start="${offset + 1}">${logItems.join('')}</ol>
        ${paginationHtml}

        <script>
          const timezones = Intl.supportedValuesOf("timeZone");
          const timezoneSelect = document.getElementById("timezoneSelect");
          const currentTimezone = new URLSearchParams(window.location.search).get("timezone") || "Asia/Bangkok";
          timezones.forEach((tz) => {
            const option = document.createElement("option");
            option.value = tz;
            option.textContent = tz;
            if (tz === currentTimezone) {
              option.selected = true;
            }
            timezoneSelect.appendChild(option);
          });
        </script>
      </body>
      </html>

    `;
      // Return the string instead of reply.send(...) + nulling the local afterwards.
      // Fastify serves handler-returned values (& its own JSON endpoints) through a
      // working compression path; an explicitly `send()`n string combined with late
      // `html = null` triggered an empty gzip body through @fastify/compress's stream
      // pipeline, which is what broke /log in production (200 with 0 bytes).
      reply.type('text/html; charset=utf-8');
      return html;
    } catch (err) {
      reply.status(500).send(`Error fetching logs: ${err.message}`);
    }
  });
}

function closeLogDb() {
  if (pruneTimer) {
    clearTimeout(pruneTimer);
    pruneTimer = null;
  }
  stmtInsert = null;
  stmtPruneBatch = null;
  if (logsDb && typeof logsDb.close === 'function') {
    try {
      logsDb.close();
    } catch (_) {}
    logsDb = null;
  }
}

module.exports = {
  initLogEngine,
  saveLogToDatabase,
  logAsync,
  registerLogRoutes,
  closeLogDb,
  getIpInfo,
  pruneOldLogs,
  createTimeZoneFormatter,
};
