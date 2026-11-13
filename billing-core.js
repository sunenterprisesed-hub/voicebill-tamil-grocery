/* Catalog validation, bill pricing, CSV and Tally draft. Runs in Node and in the browser. Money maths in paise. */
(function (root) {
'use strict';
// Catalog validation and bill pricing. All money maths in paise (integers).
const UNITS = ['kg', 'l', 'pc'];
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function validateCatalog(c) {
  if (!Array.isArray(c) || c.length === 0 || c.length > 2000) return { error: 'catalog must be a list of 1-2000 items' };
  const ids = new Set(); const out = [];
  for (const it of c) {
    if (!it || typeof it !== 'object') return { error: 'bad item' };
    const id = String(it.id || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) return { error: 'bad id: ' + id };
    if (ids.has(id)) return { error: 'duplicate id: ' + id };
    ids.add(id);
    const name = String(it.name || '').trim().slice(0, 80);
    if (!name) return { error: 'name required for ' + id };
    if (!UNITS.includes(it.unit)) return { error: 'unit must be kg, l or pc for ' + id };
    const price = Number(it.price);
    if (!Number.isFinite(price) || price < 0 || price > 1000000) return { error: 'bad price for ' + id };
    const aliases = (Array.isArray(it.aliases) ? it.aliases : []).map((a) => String(a).trim().slice(0, 60)).filter(Boolean).slice(0, 30);
    out.push({ id, name, ta: String(it.ta || '').trim().slice(0, 80), unit: it.unit, price: Math.round(price * 100) / 100, sample: !!it.sample, aliases });
  }
  return { catalog: out };
}

// lines: [{itemId, qty}] -> priced bill. Price is taken from the catalog only.
function priceBill(lines, catalog) {
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'bill has no lines' };
  if (lines.length > 200) return { error: 'too many lines' };
  const by = new Map(catalog.map((i) => [i.id, i]));
  const out = []; let totalPaise = 0; let anySample = false;
  for (const l of lines) {
    const it = by.get(l && l.itemId);
    if (!it) return { error: 'unknown item: ' + String(l && l.itemId).slice(0, 40) };
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000) return { error: 'bad quantity for ' + it.name };
    if (it.unit === 'pc' && !Number.isInteger(qty)) return { error: 'pieces must be whole numbers for ' + it.name };
    const q = Math.round(qty * 1000) / 1000;
    const amountPaise = Math.round(it.price * 100 * q);
    totalPaise += amountPaise; if (it.sample) anySample = true;
    out.push({ itemId: it.id, name: it.name, ta: it.ta, unit: it.unit, qty: q, price: it.price, amount: amountPaise / 100, samplePrice: !!it.sample });
  }
  return { bill: { lines: out, total: totalPaise / 100, samplePrices: anySample } };
}

function csvCell(v) { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function toCsv(bills) {
  const rows = [['bill_no', 'time', 'item', 'qty', 'unit', 'price', 'amount', 'bill_total', 'sample_prices'].join(',')];
  for (const b of bills) for (const l of b.lines) rows.push([b.no, b.ts, l.name, l.qty, l.unit, l.price, l.amount, b.total, b.samplePrices ? 'yes' : 'no'].map(csvCell).join(','));
  return rows.join('\n') + '\n';
}

// Draft Tally sales voucher import XML. NOT tested against a real TallyPrime; ledger/stock names must match the company's masters.
function toTallyXml(b) {
  const d = b.ts.slice(0, 10).replace(/-/g, '');
  const items = b.lines.map((l) => '        <ALLINVENTORYENTRIES.LIST>\n          <STOCKITEMNAME>' + esc(l.name) + '</STOCKITEMNAME>\n          <RATE>' + l.price + '/' + l.unit + '</RATE>\n          <AMOUNT>' + l.amount + '</AMOUNT>\n          <BILLEDQTY>' + l.qty + ' ' + l.unit + '</BILLEDQTY>\n        </ALLINVENTORYENTRIES.LIST>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!-- DRAFT: untested against TallyPrime. Review ledger and stock item names before any import. -->\n<ENVELOPE>\n  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>\n    <TALLYMESSAGE xmlns:UDF="TallyUDF">\n      <VOUCHER VCHTYPE="Sales" ACTION="Create">\n        <DATE>' + d + '</DATE>\n        <VOUCHERNUMBER>' + b.no + '</VOUCHERNUMBER>\n        <PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>\n' + items + '\n      </VOUCHER>\n    </TALLYMESSAGE>\n  </REQUESTDATA></IMPORTDATA></BODY>\n</ENVELOPE>\n';
}


var api = { validateCatalog: validateCatalog, priceBill: priceBill, toCsv: toCsv, toTallyXml: toTallyXml };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VoiceBilling = api;
})(typeof window !== 'undefined' ? window : globalThis);
