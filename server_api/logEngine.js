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

const ipCache = new Map();
const IP_CACHE_MAX = 8000;
const MAX_LOG_DATA = 4000; // truncate huge bodies (e.g. AI chat) so logs.db stays lean
const IPINFO_FETCH_TIMEOUT_MS = 4000;

function initLogEngine() {
  if (logsDb) return logsDb;
  fs.mkdirSync(path.dirname(LOGS_DB_PATH), { recursive: true });
  logsDb = new Database(LOGS_DB_PATH); // writable by design
  logsDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
  logsDb.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `);
  stmtInsert = logsDb.prepare('INSERT INTO logs (timestamp, type, data) VALUES (?, ?, ?)');
  console.log(`[LogEngine] Visitor logs enabled at: ${LOGS_DB_PATH}`);
  return logsDb;
}

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function convertToTimeZone(utcTimestamp, timeZone) {
  const date = new Date(utcTimestamp);
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
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

function registerLogRoutes(fastify) {
  fastify.get('/log', async (req, reply) => {
    const filter = req.query.filter || 'day';
    const timezone = req.query.timezone || 'Asia/Bangkok';
    let sql, rows, logItems, html;

    switch (filter) {
      case 'hour':
        sql = "SELECT * FROM logs WHERE timestamp >= datetime('now', '-1 hours') ORDER BY timestamp DESC";
        break;
      case 'week':
        sql = "SELECT * FROM logs WHERE timestamp >= datetime('now', '-7 days') ORDER BY timestamp DESC";
        break;
      case 'day':
      default:
        sql = "SELECT * FROM logs WHERE timestamp >= datetime('now', '-1 days') ORDER BY timestamp DESC";
        break;
    }

    try {
      if (!logsDb) initLogEngine();
      rows = logsDb.prepare(sql).all();

      logItems = rows.map((row) => {
        let localizedTime;
        try {
          localizedTime = convertToTimeZone(row.timestamp, timezone);
        } catch (_) {
          localizedTime = row.timestamp; // invalid timezone from the URL -> show UTC ISO
        }
        return `<li>[${localizedTime}] (${escapeHtml(row.type)}): ${escapeHtml(row.data)}</li>`;
      });
      const totalEvents = logItems.length;

      html = `
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
        </script>
      </head>
      <body>
        <p>Filter by:
          <a href="/log?filter=hour&timezone=${timezone}">Hour</a> |
          <a href="/log?filter=day&timezone=${timezone}">Day</a> |
          <a href="/log?filter=week&timezone=${timezone}">Week</a> |
          <label for="timezoneSelect">Select Time Zone:</label>
          <select id="timezoneSelect" onchange="updateTimezone()">
          </select>
        </p>

        <h1>Timestamps are in ${escapeHtml(timezone)}. Showing ${totalEvents} events from the past 1 ${escapeHtml(filter.toUpperCase())}.</h1>
        <ol>${logItems.join('')}</ol>

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
      reply.type('text/html').send(html);
    } catch (err) {
      reply.status(500).send(`Error fetching logs: ${err.message}`);
    }
    rows = null;
    logItems = null;
    html = null;
  });
}

function closeLogDb() {
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
};
