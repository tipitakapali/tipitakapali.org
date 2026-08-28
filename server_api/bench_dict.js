'use strict';
// Temporary benchmark: old-style DPD-only lookup vs new dict=all lookup
const engine = require('./dictEngine');

function bench(fn, label, runs = 5) {
  // cold
  const t0 = process.hrtime.bigint();
  const res = fn();
  const t1 = process.hrtime.bigint();
  const coldMs = Number(t1 - t0) / 1e6;

  // warm runs
  const times = [];
  for (let i = 0; i < runs; i++) {
    const a = process.hrtime.bigint();
    fn();
    const b = process.hrtime.bigint();
    times.push(Number(b - a) / 1e6);
  }
  const warmMs = times.reduce((s, x) => s + x, 0) / times.length;

  const json = JSON.stringify(res);
  const kb = (json.length / 1024).toFixed(1);
  console.log(
    `${label.padEnd(34)} cold: ${coldMs.toFixed(1).padStart(8)} ms | warm: ${warmMs.toFixed(2).padStart(8)} ms | JSON: ${kb.padStart(9)} KB`
  );
  return json;
}

const words = ['dhamma', 'bhikkhu', 'kusala', 'evaṃ', 'aniccā', 'pāpaka'];

console.log('== Per-word timings ==');
for (const w of words) {
  console.log(`\n--- "${w}" ---`);
  // New engine clears its caches via re-require not possible; emulate cold via unique words instead.
  bench(() => engine.lookupDPD(w), 'old-style: lookupDPD only');
  bench(() => engine.lookupDPDFast(w), 'new: lookupDPDFast (dpd)');
  bench(() => engine.lookupOthers(w), 'new: lookupOthers (5 dicts)');
  bench(() => engine.lookupAll(w), 'new: lookupAll (dict=all)');
}

console.log('\n== Cold-cache lookups (unique padded words that miss cache but share prefix) ==');
// lookupAll caches per word; use distinct real words for cold measurements
const coldWords = ['sīla', 'sammā', 'magga', 'phassa', 'vedanā', 'taṇhā', 'citta', 'nibbāna'];
for (const w of coldWords) {
  const t0 = process.hrtime.bigint();
  const res = engine.lookupAll(w);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  const json = JSON.stringify(res);
  const dpdN = res.counts?.dpd ?? 0;
  const synN = res.synonyms?.length ?? 0;
  console.log(
    `cold lookupAll "${w.padEnd(10)}": ${ms.toFixed(1).padStart(8)} ms | JSON ${(json.length / 1024).toFixed(1)} KB | dpd entries: ${dpdN} | synonyms: ${synN}`
  );
}

// Force worst-case: clear caches by reaching into module state is not exported; measure a rare multi-synonym word instead
console.log('\n== Worst-case common word (many synonym expansions) ==');
const t0 = process.hrtime.bigint();
const r = engine.lookupAll('attha');
const t1 = process.hrtime.bigint();
console.log(`cold lookupAll "attha": ${(Number(t1 - t0) / 1e6).toFixed(1)} ms | JSON ${(JSON.stringify(r).length / 1024).toFixed(1)} KB | synonyms: ${r.synonyms?.length} | dpd: ${r.counts?.dpd} pts: ${r.counts?.pts} abd: ${r.counts?.abd} psd: ${r.counts?.psd}`);
