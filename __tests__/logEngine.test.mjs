import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Fastify = require('../server_api/node_modules/fastify');
const {
  initLogEngine,
  registerLogRoutes,
  closeLogDb,
  pruneOldLogs,
} = require('../server_api/logEngine');

function setupTempLogApp() {
  closeLogDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log_engine_test_'));
  const dbPath = path.join(dir, 'logs.db');
  const db = initLogEngine(dbPath, { enablePruneTimer: false });
  const app = Fastify({ logger: false });
  registerLogRoutes(app);
  return { dir, dbPath, db, app };
}

function insertManyRows(db, rows) {
  const stmt = db.prepare('INSERT INTO logs (timestamp, type, data) VALUES (?, ?, ?)');
  const tx = db.transaction((items) => {
    for (const [ts, type, data] of items) {
      stmt.run(ts, type, data);
    }
  });
  tx(rows);
}

test('creates idx_logs_timestamp and uses it in EXPLAIN QUERY PLAN', async () => {
  const { dir, db, app } = setupTempLogApp();
  try {
    const idxRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_logs_timestamp'")
      .get();
    assert.equal(idxRow?.name, 'idx_logs_timestamp');

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id, timestamp, type, data FROM logs WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
      )
      .all(cutoff, 1000, 0);
    const details = plan.map((r) => r.detail).join(' | ');
    assert.match(details, /idx_logs_timestamp/i);
    assert.doesNotMatch(details, /USE TEMP B-TREE FOR ORDER BY/i);
  } finally {
    await app.close();
    closeLogDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('paginates /log with default 1000 limit, week/day/status filters, and clamping', async () => {
  const { dir, db, app } = setupTempLogApp();
  try {
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 2500; i += 1) {
      const ts = new Date(now - i * 10000).toISOString(); // within ~6.9 hours
      const is404 = i < 15;
      rows.push([
        ts,
        is404 ? 'US-Test Error' : 'US-Test',
        JSON.stringify({ url: is404 ? '/missing' : `/api/book/${i}`, status: is404 ? 404 : 200 }),
      ]);
    }
    for (let i = 0; i < 50; i += 1) {
      const ts = new Date(now - 2 * 24 * 60 * 60 * 1000 - i * 1000).toISOString(); // 2 days ago
      rows.push([ts, 'DE-Test', JSON.stringify({ url: `/old/${i}`, status: 200 })]);
    }
    insertManyRows(db, rows);

    // Page 1 default limit (1000)
    const res1 = await app.inject({
      method: 'GET',
      url: '/log?filter=day&timezone=Europe%2FBerlin',
    });
    assert.equal(res1.statusCode, 200);
    assert.match(res1.headers['content-type'], /text\/html/);
    assert.match(res1.body, /Showing 1–1000 of 2500 events from the past 1 DAY \(Page 1 of 3\)\./);
    assert.match(res1.body, /<ol start="1">/);
    assert.equal((res1.body.match(/<li>/g) || []).length, 1000);
    assert.match(res1.body, /page=2/);
    assert.match(res1.body, /page=3/);

    // Page 3
    const res3 = await app.inject({
      method: 'GET',
      url: '/log?filter=day&timezone=Europe%2FBerlin&page=3&limit=1000',
    });
    assert.equal(res3.statusCode, 200);
    assert.match(res3.body, /Showing 2001–2500 of 2500 events from the past 1 DAY \(Page 3 of 3\)\./);
    assert.match(res3.body, /<ol start="2001">/);
    assert.equal((res3.body.match(/<li>/g) || []).length, 500);
    assert.match(res3.body, /‹ Prev/);

    // Limit clamping (999999 -> 10000)
    const resClamped = await app.inject({
      method: 'GET',
      url: '/log?filter=day&limit=999999',
    });
    assert.equal(resClamped.statusCode, 200);
    assert.equal((resClamped.body.match(/<li>/g) || []).length, 2500);
    assert.match(resClamped.body, /<option value="10000" selected>10000<\/option>/);

    // Week includes 2-day-old entries (2550 total)
    const resWeek = await app.inject({
      method: 'GET',
      url: '/log?filter=week&limit=100',
    });
    assert.equal(resWeek.statusCode, 200);
    assert.match(resWeek.body, /Showing 1–100 of 2550 events from the past 1 WEEK \(Page 1 of 26\)\./);

    // Status 404 & error filtering
    const res404 = await app.inject({
      method: 'GET',
      url: '/log?filter=day&status=404',
    });
    assert.equal(res404.statusCode, 200);
    assert.match(res404.body, /Showing 1–15 of 15 events \(status: 404\) from the past 1 DAY \(Page 1 of 1\)\./);
    assert.equal((res404.body.match(/<li>/g) || []).length, 15);

    const resErr = await app.inject({
      method: 'GET',
      url: '/log?filter=day&status=error',
    });
    assert.equal(resErr.statusCode, 200);
    assert.match(resErr.body, /Showing 1–15 of 15 events \(status: error\)/);
  } finally {
    await app.close();
    closeLogDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('handles invalid timezone fallback and escapes HTML in logs', async () => {
  const { dir, db, app } = setupTempLogApp();
  try {
    const ts = new Date().toISOString();
    insertManyRows(db, [
      [ts, 'XX-<script>', JSON.stringify({ url: '/search?q=<img src=x onerror=alert(1)>', status: 200 })],
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/log?filter=day&timezone=Invalid%2FZone',
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes(`[${ts}]`));
    assert.ok(!res.body.includes('XX-<script>'));
    assert.ok(res.body.includes('XX-&lt;script&gt;'));
    assert.ok(!res.body.includes('<img src=x'));
  } finally {
    await app.close();
    closeLogDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pruneOldLogs deletes rows older than retention days in batches', async () => {
  const { dir, db, app } = setupTempLogApp();
  try {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    insertManyRows(db, [
      [new Date(now - 30 * dayMs).toISOString(), 'OLD', '{"url":"/1","status":200}'],
      [new Date(now - 20 * dayMs).toISOString(), 'OLD', '{"url":"/2","status":200}'],
      [new Date(now - 15 * dayMs).toISOString(), 'OLD', '{"url":"/3","status":200}'],
      [new Date(now - 5 * dayMs).toISOString(), 'KEEP', '{"url":"/4","status":200}'],
      [new Date(now - 1 * dayMs).toISOString(), 'KEEP', '{"url":"/5","status":200}'],
    ]);

    assert.equal(pruneOldLogs(14, 2), 2);
    assert.equal(pruneOldLogs(14, 2), 1);
    assert.equal(pruneOldLogs(14, 2), 0);

    const remaining = db.prepare('SELECT type FROM logs ORDER BY id').all();
    assert.deepEqual(
      remaining.map((r) => r.type),
      ['KEEP', 'KEEP']
    );
  } finally {
    await app.close();
    closeLogDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('serves GET /log?filter=day quickly with 20,000 rows in DB', async () => {
  const { dir, db, app } = setupTempLogApp();
  try {
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 20000; i += 1) {
      rows.push([
        new Date(now - i * 4000).toISOString(),
        'US-Los Angeles',
        `{"url":"/api/book/s0302t.tik/chapter/${i % 50}/links","status":200}`,
      ]);
    }
    insertManyRows(db, rows);

    const t0 = performance.now();
    const res = await app.inject({
      method: 'GET',
      url: '/log?filter=day&timezone=Europe%2FBerlin',
    });
    const elapsedMs = performance.now() - t0;

    assert.equal(res.statusCode, 200);
    assert.equal((res.body.match(/<li>/g) || []).length, 1000);
    assert.ok(elapsedMs < 500, `Expected < 500ms, got ${elapsedMs.toFixed(1)}ms`);
  } finally {
    await app.close();
    closeLogDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
