'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../summary-core.js');
const B = require('../billing-core.js');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createServer } = require('../server/server');

const day = new Date(); const pad = (n) => String(n).padStart(2, '0');
const KEY = day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());
const mk = (over) => Object.assign({ no: 1, ts: day.toISOString(), total: 175, samplePrices: false, lines: [
  { itemId: 'garlic', name: 'Garlic', unit: 'kg', qty: 0.25, price: 220, amount: 55 },
  { itemId: 'rice', name: 'Rice (ponni)', unit: 'kg', qty: 2, price: 60, amount: 120 }] }, over);

test('dayKey uses the local calendar day', () => {
  assert.equal(S.dayKey(day.toISOString()), KEY);
  assert.equal(S.dayKey('not a date'), null);
});

test('summarizeBills totals one day and ranks items by sales', () => {
  const s = S.summarizeBills([mk(), mk({ no: 2 }), mk({ no: 3, ts: '2020-01-01T00:00:00Z' })], KEY);
  assert.equal(s.count, 2); assert.equal(s.total, 350); assert.equal(s.avg, 175);
  assert.equal(s.top, 'Rice (ponni)');
  assert.deepEqual(s.items[0], { name: 'Rice (ponni)', amount: 240, qty: 4, unit: 'kg', qtyKnown: true });
  assert.equal(s.items[1].qty, 0.5);
});

test('summarizeBills on an empty day', () => {
  const s = S.summarizeBills([], KEY);
  assert.equal(s.count, 0); assert.equal(s.total, 0); assert.equal(s.top, null);
  assert.deepEqual(s.items, []);
});

test('amount-based lines (no quantity) do not invent quantities', () => {
  const b = mk({ lines: [{ itemId: 'soap', name: 'Bathing soap', unit: 'pc', qty: null, price: 40, amount: 40, amountBased: true }], total: 40 });
  const s = S.summarizeBills([b], KEY);
  assert.equal(s.items[0].qtyKnown, false); assert.equal(s.items[0].qty, null);
});

test('billShareText matches the receipt wording and stays honest', () => {
  const t = S.billShareText(mk({ samplePrices: true }), B.lineQtyText);
  assert.match(t, /Voice Bill #1/);
  assert.match(t, /Garlic 0.25 kg Rs 55.00/);
  assert.match(t, /Total: Rs 175.00/);
  assert.match(t, /sample prices - not a real sale/);
  assert.match(t, /not a GST tax invoice/);
});

test('summaryShareText lists the day and items', () => {
  const s = S.summarizeBills([mk()], KEY);
  const t = S.summaryShareText(s);
  assert.match(t, /day summary/); assert.match(t, /1 bill\(s\), total Rs 175.00/); assert.match(t, /Rice \(ponni\) 2 kg Rs 120.00/);
});

test('waMeLink encodes the message and asks for no phone number', () => {
  const u = S.waMeLink('a b\nRs 5 & more');
  assert.ok(u.startsWith('https://wa.me/?text='));
  assert.ok(u.includes('a%20b%0ARs%205%20%26%20more'));
});

test('server mode: browser files served from repo root, mode.js never local, code not served', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-'));
  const srv = createServer(dir); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const idx = await fetch(base + '/'); assert.equal(idx.status, 200);
  const mode = await (await fetch(base + '/mode.js')).text(); assert.match(mode, /VB_LOCAL_MODE = false/);
  for (const f of ['/server/server.js', '/package.json', '/Dockerfile', '/test/parser.test.js', '/summary-core.js.x'])
    assert.equal((await fetch(base + f)).status, 404, f);
  assert.equal((await fetch(base + '/summary-core.js')).status, 200);
  srv.close();
});
