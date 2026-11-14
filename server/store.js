'use strict';
// Tiny JSON-file store with atomic writes. Data stays on the machine running the server.
const fs = require('fs');
const path = require('path');
const seed = require('./catalog.seed');

function makeStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cf = path.join(dir, 'catalog.json');
  const bf = path.join(dir, 'bills.json');
  // A missing file means "empty"; an unreadable file is moved aside (never silently overwritten) and an error is raised.
  const read = (f, d) => {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return d; throw e; }
    try { return JSON.parse(raw); } catch {
      fs.renameSync(f, f + '.corrupt-' + Date.now());
      throw new Error('data file was unreadable and was moved aside: ' + path.basename(f));
    }
  };
  const write = (f, v) => { const t = f + '.tmp'; const fd = fs.openSync(t, 'w'); fs.writeSync(fd, JSON.stringify(v, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(t, f); };
  if (!fs.existsSync(cf)) write(cf, seed);
  if (!fs.existsSync(bf)) write(bf, []);
  return {
    getCatalog: () => read(cf, seed),
    setCatalog: (c) => write(cf, c),
    getBills: () => read(bf, []),
    // number + save in one synchronous step so concurrent requests can never share a bill number
    addBill(b) { const all = read(bf, []); const no = all.reduce((m, x) => Math.max(m, x.no), 0) + 1; const bill = Object.assign({ no }, b); all.push(bill); write(bf, all); return bill; }
  };
}
module.exports = { makeStore };
