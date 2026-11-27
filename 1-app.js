'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var catalog = [], lines = [], recog = null, listening = false;
  var token = new URLSearchParams(location.search).get('token') || '';
  var hdr = { 'Content-Type': 'application/json' }; if (token) hdr['X-App-Token'] = token;

  function el(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'text') e.textContent = props[k]; else if (k === 'class') e.className = props[k]; else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  var LOCAL = !!window.VB_LOCAL_MODE;
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { throw new Error('This browser blocked saving data (' + e.name + ')'); } }
  function download(name, type, text) { var u = URL.createObjectURL(new Blob([text], { type: type })); var x = document.createElement('a'); x.href = u; x.download = name; document.body.appendChild(x); x.click(); x.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }
  var Store = LOCAL ? {
    getCatalog: function () {
      var stored = lsGet('vb.catalog.v1', null);
      if (!stored) { var fresh = JSON.parse(JSON.stringify(window.VB_SEED)); lsSet('vb.catalog.v1', fresh); return Promise.resolve(fresh); }
      // app updates add spoken aliases to the seed; merge them into the stored catalog
      // without touching edited prices, custom items, deletions or history.
      var m = VoiceBilling.mergeSeedAliases(stored, window.VB_SEED);
      if (!m.changed) return Promise.resolve(stored);
      var v = VoiceBilling.validateCatalog(m.catalog);
      if (v.error) return Promise.resolve(stored);
      lsSet('vb.catalog.v1', v.catalog);
      return Promise.resolve(v.catalog);
    },
    putCatalog: function (c) { var r = VoiceBilling.validateCatalog(c); return r.error ? Promise.reject(new Error(r.error)) : (lsSet('vb.catalog.v1', r.catalog), Promise.resolve(r.catalog)); },
    postBill: function (ls) { try { var r = VoiceBilling.priceBill(ls, catalog); if (r.error) throw new Error(r.error); var all = lsGet('vb.bills.v1', []); var no = all.reduce(function (m, b) { return Math.max(m, b.no); }, 0) + 1; var bill = Object.assign({ no: no, ts: new Date().toISOString() }, r.bill); all.push(bill); lsSet('vb.bills.v1', all); return Promise.resolve(bill); } catch (e) { return Promise.reject(e); } },
    getBills: function () { return Promise.resolve(lsGet('vb.bills.v1', [])); }
  } : {
    getCatalog: function () { return api('/api/catalog'); },
    putCatalog: function (c) { return api('/api/catalog', { method: 'PUT', body: JSON.stringify({ catalog: c }) }); },
    postBill: function (ls) { return api('/api/bills', { method: 'POST', body: JSON.stringify({ lines: ls }) }); },
    getBills: function () { return api('/api/bills'); }
  };
  function api(path, opt) { return fetch(path, Object.assign({ headers: hdr }, opt)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); }); }
  function rs(n) { return 'Rs ' + (Math.round(n * 100) / 100).toFixed(2); }
  function byId(id) { return catalog.find(function (c) { return c.id === id; }); }
  function dq(l) { var it = byId(l.itemId); return it && l.amount > 0 ? VoiceBilling.derivedQty(it, Math.round(l.amount * 100)) : null; }
  function qtyText(l) { if (l.amount > 0) { var d = dq(l); return 'Rs ' + l.amount + ' worth' + (d != null ? ' (about ' + d + ' ' + l.unit + ')' : ', no quantity'); } return l.qty == null ? '' : (l.qty < 1 && l.unit !== 'pc' ? Math.round(l.qty * 1000) + ' ' + (l.unit === 'kg' ? 'g' : 'ml') + ' (' + l.qty + ' ' + l.unit + ')' : l.qty + ' ' + l.unit); }

  // ---- tabs ----
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      ['bill', 'catalog', 'history', 'summary'].forEach(function (t) { $('tab-' + t).hidden = t !== b.dataset.tab; });
      if (b.dataset.tab === 'history') loadHistory(); if (b.dataset.tab === 'catalog') renderCatalog(); if (b.dataset.tab === 'summary') renderSummary();
    };
  });

  // ---- voice ----
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function setupVoice() {
    if (!SR) { $('micHelp').textContent = 'Live speech needs Chrome or Edge (Android or desktop). This browser has none, so type or paste what was said.'; $('mic').disabled = true; return; }
    if (!window.isSecureContext) { $('micHelp').textContent = 'The microphone only works on https or localhost. Open the app that way, or type the order.'; $('mic').disabled = true; return; }
    $('micHelp').textContent = 'Speech is recognised by the browser\'s speech service (Chrome sends audio to Google). Check the text, then Add to bill.' + (LOCAL ? ' Bills and catalog are saved only in this browser.' : '');
    recog = new SR(); recog.interimResults = true; recog.continuous = false; recog.maxAlternatives = 1;
    recog.onresult = function (e) { var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + ' '; $('said').value = t.trim(); };
    recog.onerror = function (e) { stopUi(); $('micHelp').textContent = 'Mic problem: ' + e.error + (e.error === 'not-allowed' ? ' (allow microphone for this site)' : '') + '. You can type instead.'; };
    recog.onend = function () { var had = $('said').value.trim(); stopUi(); if (had) addFromText(); };
  }
  function stopUi() { listening = false; $('mic').classList.remove('live'); $('micLabel').textContent = 'Tap and speak'; }
  $('mic').onclick = function () {
    if (!recog) return;
    if (listening) { recog.stop(); return; }
    $('said').value = ''; recog.lang = $('lang').value;
    try { recog.start(); listening = true; $('mic').classList.add('live'); $('micLabel').textContent = 'Listening... tap to stop'; } catch (e) { stopUi(); }
  };

  // ---- parsing into bill lines ----
  function addFromText() {
    var text = $('said').value.trim(); if (!text) return;
    var r = VoiceParser.parse(text, catalog);
    r.lines.forEach(function (l) { l.confirmed = l.status === 'ok'; lines.push(l); });
    $('warn').textContent = r.warnings.join(' ') || (r.lines.length ? '' : 'Nothing recognised. Try again or type it.');
    $('said').value = ''; render();
  }
  $('add').onclick = addFromText;
  $('clearSaid').onclick = function () { $('said').value = ''; };
  $('newBill').onclick = function () { lines = []; $('receipt').hidden = true; render(); };
  $('undo').onclick = function () { lines.pop(); render(); };

  // ---- read the total aloud (voice-first: the shopkeeper hears the bill) ----
  var speakOn = lsGet('vb.speakTotal', false);
  function speakUi() { $('speakTotal').setAttribute('aria-pressed', speakOn ? 'true' : 'false'); $('speakTotal').textContent = 'Read total aloud: ' + (speakOn ? 'on' : 'off'); }
  $('speakTotal').onclick = function () {
    speakOn = !speakOn; try { lsSet('vb.speakTotal', speakOn); } catch (e) { /* private mode: keep it for this session */ }
    if (!speakOn && window.speechSynthesis) window.speechSynthesis.cancel();
    speakUi();
  };
  function speakTotal(total) {
    if (!speakOn || !window.speechSynthesis) return;
    var tamil = $('lang').value === 'ta-IN';
    var u = new SpeechSynthesisUtterance(tamil ? 'மொத்தம் ' + total + ' ரூபாய்' : 'Total ' + total + ' rupees');
    u.lang = tamil ? 'ta-IN' : 'en-IN';
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }

  function lineReady(l) { return l.itemId && (l.qty > 0 || l.amount > 0) && (l.status === 'ok' || l.confirmed); }
  function amount(l) { var it = byId(l.itemId); if (it && l.amount > 0) return l.amount; return it && l.qty > 0 ? Math.round(it.price * 100 * l.qty) / 100 : 0; }

  function render() {
    var box = $('lines'); box.textContent = '';
    var total = 0, sample = false, blockers = 0;
    lines.forEach(function (l, i) {
      var it = byId(l.itemId); var ready = lineReady(l);
      if (!ready) blockers++;
      if (it && it.sample && (l.amount > 0 ? dq(l) != null : l.qty > 0)) sample = true;
      total += amount(l);
      var top = el('div', { class: 'top' }, [el('span', { text: it ? it.name + (it.ta ? ' / ' + it.ta : '') : (l.name || '?') }), el('span', { text: it && (l.qty > 0 || l.amount > 0) ? rs(amount(l)) : '' })]);
      var cls = 'line ' + (ready ? '' : (l.status === 'ok' ? 'check' : l.status));
      var d = el('div', { class: cls.trim() }, [top]);
      d.appendChild(el('div', { class: 'hint', text: 'Heard: "' + l.text + '"' + (it ? ' | ' + qtyText(l) + ' | catalog ' + rs(it.price) + '/' + it.unit : '') }));
      if (it && it.sample && (!(l.amount > 0) || dq(l) != null)) d.lastChild.appendChild(el('span', { class: 'badge', text: 'SAMPLE price' }));
      if (l.note && !l.confirmed) d.appendChild(el('div', { class: 'note', text: l.note }));
      var sel = el('select', { 'aria-label': 'Item' });
      sel.appendChild(el('option', { value: '', text: '- choose item -' }));
      var ids = (l.candidates && l.candidates.length > 1) ? l.candidates : catalog.map(function (c) { return c.id; });
      ids.forEach(function (id) { var c = byId(id); if (c) { var o = el('option', { value: id, text: c.name }); if (id === l.itemId) o.selected = true; sel.appendChild(o); } });
      sel.onchange = function () { var c = byId(sel.value); l.itemId = sel.value || null; if (c) { l.unit = c.unit; l.name = c.name; if (l.status === 'unknown') l.status = 'check'; } l.confirmed = false; render(); };
      var q = el('input', { type: 'number', step: 'any', min: '0', value: l.qty == null || l.amount > 0 ? '' : String(l.qty), 'aria-label': 'Quantity (' + (l.unit || 'unit') + ')', placeholder: l.unit || 'qty' });
      q.onchange = function () { var v = parseFloat(q.value); l.qty = v > 0 ? v : null; if (v > 0) l.amount = null; l.confirmed = false; if (l.status === 'noqty' && l.qty) l.status = 'check'; render(); };
      var am = el('input', { type: 'number', step: '0.01', min: '0', value: l.amount > 0 ? String(l.amount) : '', 'aria-label': 'Rupee amount', placeholder: 'or Rs' });
      am.onchange = function () { var v = Math.round(parseFloat(am.value) * 100) / 100; l.amount = v > 0 ? v : null; if (v > 0) l.qty = null; l.confirmed = false; if (l.status === 'noqty' && l.amount) l.status = 'check'; render(); };
      var rm = el('button', { text: 'Remove' }); rm.onclick = function () { lines.splice(i, 1); render(); };
      d.appendChild(el('div', { class: 'ctl' }, [sel, q, am, rm]));
      if (!ready && l.itemId && (l.qty > 0 || l.amount > 0)) { var ok = el('button', { class: 'primary', text: 'Confirm ' + (it ? it.name : '') + ' ' + (l.amount > 0 ? 'Rs ' + l.amount : l.qty + ' ' + (l.unit || '')) }); ok.onclick = function () { l.confirmed = true; render(); }; d.appendChild(el('div', { class: 'row' }, [ok])); }
      box.appendChild(d);
    });
    if (!lines.length) box.appendChild(el('p', { class: 'hint', text: 'No items yet. Tap the mic and say the list, for example "poondu kaal kilo, arisi rendu kilo".' }));
    $('total').textContent = rs(total);
    $('sampleBanner').hidden = !sample;
    $('gate').textContent = !lines.length ? '' : blockers ? blockers + ' line(s) still need a fix or confirmation.' : 'All lines confirmed.';
    $('finalize').disabled = !lines.length || blockers > 0;
    $('undo').disabled = !lines.length;
  }

  $('finalize').onclick = function () {
    $('finalize').disabled = true;
    Store.postBill(lines.map(function (l) { return l.amount > 0 ? { itemId: l.itemId, amount: l.amount } : { itemId: l.itemId, qty: l.qty }; }))
      .then(function (b) { speakTotal(b.total); return showReceipt(b); }).then(function () { lines = []; render(); })
      .catch(function (e) { $('gate').textContent = 'Could not save: ' + e.message; $('finalize').disabled = false; });
  };
  function showReceipt(b) {
    var r = $('receipt'); r.hidden = false; r.textContent = '';
    r.appendChild(el('h2', { text: 'Bill #' + b.no }));
    r.appendChild(el('p', { class: 'hint', text: new Date(b.ts).toLocaleString() + ' | Receipt only, not a GST tax invoice' }));
    var t = el('table'); t.appendChild(el('tr', {}, [el('th', { text: 'Item' }), el('th', { text: 'Qty' }), el('th', { class: 'r', text: 'Rs' })]));
    b.lines.forEach(function (l) { t.appendChild(el('tr', {}, [el('td', { text: l.name }), el('td', { text: VoiceBilling.lineQtyText(l) }), el('td', { class: 'r', text: l.amount.toFixed(2) })])); });
    t.appendChild(el('tr', {}, [el('th', { text: 'Total' }), el('th'), el('th', { class: 'r', text: b.total.toFixed(2) })]));
    r.appendChild(t);
    if (b.samplePrices) r.appendChild(el('p', { class: 'banner warn', text: 'This bill used SAMPLE prices. Not for a real sale.' }));
    var pr = el('button', { text: 'Print / save PDF' }); pr.onclick = function () { window.print(); };
    r.appendChild(pr);
    // Share the receipt as ready-to-send text; the shopkeeper picks the contact inside WhatsApp.
    var wa = el('a', { class: 'btn', href: Summary.waMeLink(Summary.billShareText(b, VoiceBilling.lineQtyText)), target: '_blank', rel: 'noopener', text: 'Send bill on WhatsApp' });
    r.appendChild(wa);
    r.scrollIntoView();
  }

  // ---- catalog editor ----
  function renderCatalog() {
    var box = $('catalogRows'); box.textContent = '';
    catalog.forEach(function (c, i) {
      var name = el('input', { value: c.name, 'aria-label': 'Name' }), ta = el('input', { value: c.ta || '', placeholder: 'Tamil name', 'aria-label': 'Tamil name' });
      var unit = el('select', { 'aria-label': 'Unit' }); ['kg', 'l', 'pc'].forEach(function (u) { var o = el('option', { value: u, text: 'per ' + u }); if (u === c.unit) o.selected = true; unit.appendChild(o); });
      var price = el('input', { type: 'number', step: '0.01', min: '0', value: String(c.price), 'aria-label': 'Price' });
      var al = el('input', { value: (c.aliases || []).join(', '), placeholder: 'aliases, comma separated', 'aria-label': 'Aliases' });
      var del = el('button', { text: 'Delete' });
      name.onchange = function () { c.name = name.value; }; ta.onchange = function () { c.ta = ta.value; }; unit.onchange = function () { c.unit = unit.value; };
      price.onchange = function () { c.price = parseFloat(price.value) || 0; c.sample = false; renderCatalog(); };
      al.onchange = function () { c.aliases = al.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); };
      del.onclick = function () { catalog.splice(i, 1); renderCatalog(); };
      var row = el('div', { class: 'crow' }, [name, ta, unit, price, el('div', { class: 'w' }, [al]), el('div', { class: 'w' }, [del])]);
      if (c.sample) row.insertBefore(el('span', { class: 'badge', text: 'SAMPLE price - set the real one' }), row.firstChild);
      box.appendChild(row);
    });
  }
  $('addItem').onclick = function () { catalog.unshift({ id: 'item-' + Date.now().toString(36), name: 'New item', ta: '', unit: 'kg', price: 0, sample: true, aliases: [] }); renderCatalog(); };
  $('saveCatalog').onclick = function () {
    Store.putCatalog(catalog).then(function (c) { catalog = c; $('catMsg').textContent = 'Saved.'; renderCatalog(); render(); })
      .catch(function (e) { $('catMsg').textContent = 'Not saved: ' + e.message; });
  };

  // ---- history ----
  function loadHistory() {
    Store.getBills().then(function (bills) {
      var h = $('history'); h.textContent = '';
      if (!bills.length) h.appendChild(el('p', { class: 'hint', text: 'No bills yet.' }));
      var today = new Date().toDateString(), sum = 0;
      bills.slice().reverse().forEach(function (b) {
        if (new Date(b.ts).toDateString() === today) sum += b.total;
        var a = el('a', { class: 'btn', href: LOCAL ? '#' : '/api/bills/' + b.no + '/tally.xml' + (token ? '?token=' + encodeURIComponent(token) : ''), text: 'Tally draft XML' });
        if (LOCAL) a.onclick = (function (bb) { return function (ev) { ev.preventDefault(); download('bill-' + bb.no + '-tally-UNTESTED.xml', 'application/xml', VoiceBilling.toTallyXml(bb)); }; })(b);
        h.appendChild(el('div', { class: 'line' }, [el('div', { class: 'top' }, [el('span', { text: '#' + b.no + ' ' + new Date(b.ts).toLocaleString() }), el('span', { text: rs(b.total) })]),
          el('div', { class: 'hint', text: b.lines.map(function (l) { return l.name + ' ' + VoiceBilling.lineQtyText(l); }).join(', ') + (b.samplePrices ? ' (sample prices)' : '') }), a]));
      });
      h.insertBefore(el('p', { class: 'hint', text: 'Today: ' + rs(sum) }), h.firstChild);
    }).catch(function (e) { $('history').textContent = 'Could not load: ' + e.message; });
    if (LOCAL) { $('csv').href = '#'; $('csv').onclick = function (ev) { ev.preventDefault(); Store.getBills().then(function (bs) { download('bills.csv', 'text/csv', VoiceBilling.toCsv(bs)); }); }; }
    else if (token) $('csv').href = '/api/bills.csv?token=' + encodeURIComponent(token);
  }

  // ---- day summary ----
  function renderSummary() {
    var d = $('sumDate'); if (!d.value) d.value = Summary.todayKey();
    Store.getBills().then(function (bills) {
      var s = Summary.summarizeBills(bills, d.value);
      var box = $('sumBox'); box.textContent = '';
      box.appendChild(el('p', { class: 'hint', text: s.count ? s.count + ' bill(s) | Total ' + rs(s.total) + ' | Average bill ' + rs(s.avg) + (s.sample ? ' | includes SAMPLE prices' : '') : 'No bills on this day.' }));
      if (s.top) box.appendChild(el('p', { class: 'hint', text: 'Top item by sales: ' + s.top }));
      if (s.items.length) {
        var t = el('table');
        t.appendChild(el('tr', {}, [el('th', { text: 'Item' }), el('th', { text: 'Qty sold' }), el('th', { class: 'r', text: 'Rs' })]));
        s.items.forEach(function (it) {
          t.appendChild(el('tr', {}, [el('td', { text: it.name }), el('td', { text: it.qtyKnown && it.qty != null ? it.qty + ' ' + it.unit : '-' }), el('td', { class: 'r', text: it.amount.toFixed(2) })]));
        });
        box.appendChild(t);
      }
      var wa = $('sumShare');
      if (s.count) { wa.hidden = false; wa.href = Summary.waMeLink(Summary.summaryShareText(s)); } else { wa.hidden = true; }
    }).catch(function (e) { $('sumBox').textContent = 'Could not load: ' + e.message; });
  }
  $('sumDate').onchange = renderSummary;

  speakUi();
  setupVoice();
  Store.getCatalog().then(function (c) { catalog = c; render(); }).catch(function (e) { $('lines').textContent = 'Cannot load catalog: ' + e.message; });
})();
