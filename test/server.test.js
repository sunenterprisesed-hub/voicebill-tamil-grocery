'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createServer } = require('../server/server');

async function boot(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-'));
  const srv = createServer(dir, opts); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port; ORIGIN = base;
  return { srv, base, close: () => srv.close() };
}
let ORIGIN = ''; const J = (b, o = {}) => ({ headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(b), ...o });

test('prices come from the catalog, client price ignored', async () => {
  const { base, close } = await boot();
  const r = await fetch(base + '/api/bills', J({ lines: [{ itemId: 'garlic', qty: 0.25, price: 1 }, { itemId: 'rice', qty: 2 }] }, { method: 'POST' }));
  const b = await r.json(); assert.equal(r.status, 201);
  assert.equal(b.lines[0].amount, 55); assert.equal(b.lines[1].amount, 120); assert.equal(b.total, 175); assert.equal(b.samplePrices, true);
  close();
});
test('rejects unknown item, bad qty, fractional pieces', async () => {
  const { base, close } = await boot();
  for (const lines of [[{ itemId: 'nope', qty: 1 }], [{ itemId: 'rice', qty: -1 }], [{ itemId: 'egg', qty: 1.5 }], []]) {
    const r = await fetch(base + '/api/bills', J({ lines }, { method: 'POST' })); assert.equal(r.status, 400);
  }
  close();
});
test('editing a price clears sample flag and bills use it', async () => {
  const { base, close } = await boot();
  const cat = await (await fetch(base + '/api/catalog')).json();
  cat.find((c) => c.id === 'garlic').price = 250; cat.find((c) => c.id === 'garlic').sample = false;
  const put = await fetch(base + '/api/catalog', J({ catalog: cat }, { method: 'PUT' })); assert.equal(put.status, 200);
  const b = await (await fetch(base + '/api/bills', J({ lines: [{ itemId: 'garlic', qty: 1 }] }, { method: 'POST' }))).json();
  assert.equal(b.total, 250); assert.equal(b.samplePrices, false); assert.equal(b.no, 1);
  const csv = await (await fetch(base + '/api/bills.csv')).text(); assert.match(csv, /Garlic/);
  const x = await (await fetch(base + '/api/bills/1/tally.xml')).text(); assert.match(x, /DRAFT: untested/);
  close();
});
test('invalid catalog rejected', async () => {
  const { base, close } = await boot();
  const r = await fetch(base + '/api/catalog', J({ catalog: [{ id: 'A b', name: 'x', unit: 'kg', price: 1 }] }, { method: 'PUT' })); assert.equal(r.status, 400);
  close();
});
test('token enforced when configured; path traversal blocked; json only', async () => {
  const { base, close } = await boot({ token: 's3cret' });
  assert.equal((await fetch(base + '/api/catalog')).status, 401);
  assert.equal((await fetch(base + '/api/catalog', { headers: { 'x-app-token': 's3cret' } })).status, 200);
  assert.equal((await fetch(base + '/..%2f..%2fetc/passwd')).status >= 400, true);
  const t = await fetch(base + '/api/bills', { method: 'POST', headers: { 'x-app-token': 's3cret', 'content-type': 'text/plain', origin: base }, body: '{}' }); assert.equal(t.status, 415);
  close();
});
test('csv formula injection neutralised', () => {
  const { toCsv } = require('../server/billing');
  const out = toCsv([{ no: 1, ts: 't', total: 1, samplePrices: false, lines: [{ name: '=cmd()', qty: 1, unit: 'kg', price: 1, amount: 1 }] }]);
  assert.match(out, /"'=cmd\(\)"/);
});
test('serves the app with security headers', async () => {
  const { base, close } = await boot();
  const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy'));
  close();
});

test('cross-origin and cross-site state changes are blocked, even with a valid body', async () => {
  const { base, close } = await boot();
  const body = JSON.stringify({ lines: [{ itemId: 'rice', qty: 1 }] });
  const evil = await fetch(base + '/api/bills', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body });
  assert.equal(evil.status, 403);
  const site = await fetch(base + '/api/bills', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body });
  assert.equal(site.status, 403);
  const none = await fetch(base + '/api/bills', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(none.status, 403); // no Origin and no token: refused
  const cat = await (await fetch(base + '/api/catalog')).json();
  const put = await fetch(base + '/api/catalog', { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ catalog: cat }) });
  assert.equal(put.status, 403);
  assert.equal((await (await fetch(base + '/api/bills')).json()).length, 0);
  close();
});
test('token server: wrong/missing token rejected for every state-changing call', async () => {
  const { base, close } = await boot({ token: 'abc' });
  for (const [m, p] of [['POST', '/api/bills'], ['PUT', '/api/catalog']]) {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', origin: base, 'x-app-token': 'wrong' }, body: '{}' });
    assert.equal(r.status, 401);
  }
  close();
});
test('concurrent bills get unique numbers and all persist', async () => {
  const { base, close } = await boot();
  const rs = await Promise.all(Array.from({ length: 25 }, () => fetch(base + '/api/bills', J({ lines: [{ itemId: 'rice', qty: 1 }] }, { method: 'POST' }))));
  assert.ok(rs.every((r) => r.status === 201));
  const all = await (await fetch(base + '/api/bills')).json();
  assert.equal(all.length, 25); assert.equal(new Set(all.map((b) => b.no)).size, 25);
  close();
});
test('corrupt bills file is preserved, not overwritten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbc-'));
  const { makeStore } = require('../server/store');
  const st = makeStore(dir); st.addBill({ ts: 't', lines: [], total: 1 });
  fs.writeFileSync(path.join(dir, 'bills.json'), '{ not json');
  assert.throws(() => st.addBill({ ts: 't', lines: [], total: 2 }), /moved aside/);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('bills.json.corrupt-')));
});
test('oversized body rejected', async () => {
  const { base, close } = await boot();
  const r = await fetch(base + '/api/bills', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ lines: [], pad: 'x'.repeat(300000) }) }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413);
  close();
});

test('server prices amount lines from the catalog and rejects qty+amount', async () => {
  const { base, close } = await boot();
  let r = await fetch(base + '/api/bills', J({ lines: [{ itemId: 'curry-leaves', amount: 5 }] }, { method: 'POST' }));
  assert.equal(r.status, 201); const b = await r.json(); assert.equal(b.total, 5); assert.equal(b.lines[0].qty, 0.05);
  r = await fetch(base + '/api/bills', J({ lines: [{ itemId: 'curry-leaves', amount: 5, qty: 3 }] }, { method: 'POST' })); assert.equal(r.status, 400);
  close();
});
