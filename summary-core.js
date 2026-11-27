'use strict';
/* Day summary and bill sharing helpers for Voice Bill.
   Pure functions, shared by the browser UI and the Node tests. No secrets, no network. */
(function (root) {

  // Local calendar day key (YYYY-MM-DD) for an ISO timestamp or Date.
  function dayKey(ts) {
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return null;
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function todayKey() { return dayKey(new Date()); }

  // Aggregate one day's saved bills into counts, totals and per-item sales.
  function summarizeBills(bills, key) {
    var list = (Array.isArray(bills) ? bills : []).filter(function (b) { return dayKey(b.ts) === key; });
    var total = 0, byItem = {};
    list.forEach(function (b) {
      total += Number(b.total) || 0;
      (b.lines || []).forEach(function (l) {
        var e = byItem[l.name] || (byItem[l.name] = { name: l.name, amount: 0, qty: 0, unit: l.unit, qtyKnown: true });
        e.amount += Number(l.amount) || 0;
        if (l.qty != null && e.unit === l.unit) e.qty += l.qty; else e.qtyKnown = false;
      });
    });
    var items = Object.keys(byItem).map(function (k) { return byItem[k]; });
    items.forEach(function (e) {
      e.amount = Math.round(e.amount * 100) / 100;
      e.qty = Math.round(e.qty * 1000) / 1000;
      if (!e.qtyKnown) e.qty = null;
    });
    items.sort(function (a, b) { return b.amount - a.amount || (a.name < b.name ? -1 : 1); });
    total = Math.round(total * 100) / 100;
    return {
      date: key,
      count: list.length,
      total: total,
      avg: list.length ? Math.round((total / list.length) * 100) / 100 : 0,
      items: items,
      top: items.length ? items[0].name : null,
      sample: list.some(function (b) { return b.samplePrices; })
    };
  }

  // Plain-text receipt for sharing a finalized bill (WhatsApp etc.).
  // lineQtyText: pass VoiceBilling.lineQtyText so wording matches the on-screen receipt.
  function billShareText(b, lineQtyText) {
    var qt = typeof lineQtyText === 'function' ? lineQtyText : function (l) { return (l.qty != null ? l.qty + ' ' + l.unit : ''); };
    var rows = ['Voice Bill #' + b.no, new Date(b.ts).toLocaleString()];
    (b.lines || []).forEach(function (l) {
      rows.push('- ' + l.name + ' ' + qt(l) + ' Rs ' + Number(l.amount).toFixed(2));
    });
    rows.push('Total: Rs ' + Number(b.total).toFixed(2));
    if (b.samplePrices) rows.push('(sample prices - not a real sale)');
    rows.push('Receipt only, not a GST tax invoice.');
    return rows.join('\n');
  }

  // Plain-text day summary for sharing with a business partner or family.
  function summaryShareText(s) {
    var rows = ['Voice Bill - day summary ' + s.date, s.count + ' bill(s), total Rs ' + s.total.toFixed(2)];
    s.items.forEach(function (it) {
      rows.push('- ' + it.name + (it.qtyKnown && it.qty != null ? ' ' + it.qty + ' ' + it.unit : '') + ' Rs ' + it.amount.toFixed(2));
    });
    if (s.sample) rows.push('(includes sample prices)');
    return rows.join('\n');
  }

  // wa.me share link: opens WhatsApp with the text ready to send. No phone number means
  // the shopkeeper picks the contact inside WhatsApp.
  function waMeLink(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }

  var api = { dayKey: dayKey, todayKey: todayKey, summarizeBills: summarizeBills, billShareText: billShareText, summaryShareText: summaryShareText, waMeLink: waMeLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Summary = api;
})(typeof window !== 'undefined' ? window : globalThis);
