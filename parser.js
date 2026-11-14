/* Tamil / Tanglish grocery utterance parser. Pure functions, no network.
   Works in Node (module.exports) and in the browser (window.VoiceParser).
   Prices are NEVER decided here: parse() only maps words to catalog items and quantities. */
(function (root) {
  'use strict';

  // ---- normalisation -------------------------------------------------------
  // Speech-recognition confusables in Tamil script: ள/ல, ண/ன and ற/ர are constantly mixed up
  // by the recogniser (e.g. jaggery heard as வெள்ளம் for catalog வெல்லம்). Canonicalise for
  // MATCHING ONLY; the heard text and the catalog display keep their original spelling.
  function tamilCanon(s) {
    return String(s).replace(/\u0BB3/g, '\u0BB2').replace(/\u0BA3/g, '\u0BA9').replace(/\u0BB1/g, '\u0BB0');
  }

  function skeleton(s) {
    return String(s).toLowerCase()
      .replace(/aa+/g, 'a').replace(/ee+|ii+/g, 'i').replace(/oo+|uu+/g, 'u')
      .replace(/zh/g, 'l').replace(/dh|th|t/g, 't').replace(/w/g, 'v')
      .replace(/ph/g, 'f').replace(/[^a-z0-9\u0B80-\u0BFF ]/g, '')
      .replace(/([a-z])\1+/g, '$1');
  }

  function tokenize(text) {
    return String(text).replace(/[\u200c\u200d]/g, '')
      .replace(/(?:\u20B9|\brs\.?)\s*(\d[\d.]*)/gi, ' rs $1 ')
      .replace(/(\d)\s*(?:\u20B9|rs\b\.?|rupees?\b|rupais?\b|rubais?\b|\u0BB0\u0BC2\u0BAA\u0BBE\u0BAF\u0BCD(?:\u0B95\u0BCD\u0B95\u0BC1)?)/gi, '$1 rs ')
      .replace(/\u20B9/g, ' rs ')
      // recognisers glue digits to words: "வெள்ளம்10rs", "5kg", "arisi2kilo"
      .replace(/([a-z\u0B80-\u0BFF])(\d)/gi, '$1 $2')
      .replace(/(\d)([a-z\u0B80-\u0BFF])/gi, '$1 $2')
      .split(/[\s,;|\/\u0964]+/)
      .map(function (t) { return t.replace(/^[.:!?"'()]+|[.:!?"'()]+$/g, ''); })
      .filter(Boolean);
  }

  // ---- dictionaries (skeleton keyed; Tamil script keyed as is) -------------
  function dict(obj) {
    var d = {};
    Object.keys(obj).forEach(function (k) {
      obj[k].split(' ').forEach(function (w) { if (w) d[skeleton(w)] = k; });
    });
    return d;
  }
  // number words -> value
  var NUM = {};
  [[1, 'onnu oru ondru ondre ondu one ஒன்று ஒரு ஒண்ணு'],
   [2, 'rendu irandu two இரண்டு ரெண்டு'],
   [3, 'moonu moondru mundru three மூன்று மூணு'],
   [4, 'naalu nangu four நான்கு நாலு'],
   [5, 'anju aindhu ainthu five ஐந்து அஞ்சு'],
   [6, 'aaru six ஆறு'],
   [7, 'ezhu yezhu seven ஏழு'],
   [8, 'ettu eight எட்டு'],
   [9, 'onbadhu ombodhu nine ஒன்பது'],
   [10, 'pathu ten பத்து'],
   [11, 'pathinonu'],
   [15, 'pathinainthu pathinanju'],
   [20, 'irubathu irupathu twenty இருபது'],
   [30, 'muppathu thirty முப்பது'],
   [40, 'naarpathu nalupathu forty நாற்பது'],
   [50, 'aimbathu ainpathu fifty ஐம்பது'],
   [60, 'arubathu aruvathu sixty அறுபது'],
   [70, 'ezhubathu seventy எழுபது'],
   [80, 'enbathu eighty எண்பது'],
   [90, 'thonnooru ninety தொண்ணூறு'],
   [12, 'pannirandu panniranda twelve'],
   [100, 'nooru hundred நூறு'],
   [200, 'irunooru இருநூறு'],
   [300, 'munnooru முன்னூறு'],
   [400, 'naanooru நானூறு'],
   [500, 'ainooru ஐநூறு']].forEach(function (p) {
    p[1].split(' ').forEach(function (w) { NUM[skeleton(w)] = p[0]; });
  });
  var FRACTION = {};
  [[0.25, 'kaal kal கால் quarter'], [0.5, 'arai ara அரை half'],
   [0.75, 'mukkaal mukkal முக்கால்'],
   [1.25, 'ondrekaal ondrekal onnekaal'], [1.5, 'ondrara ondara oonnara ஒன்றரை'],
   [2.5, 'rendarai irandarai இரண்டரை']].forEach(function (p) {
    p[1].split(' ').forEach(function (w) { FRACTION[skeleton(w)] = p[0]; });
  });
  var UNIT = dict({
    kg: 'kilo kg kgs keelo kilogram கிலோ',
    g: 'gram grams gm gms g கிராம்',
    l: 'litre liter ltr lt l லிட்டர்',
    ml: 'ml மிலி',
    pc: 'packet pocket pkt pc pcs piece pieces nos number பாக்கெட் எண்ணம்',
    dozen: 'dozen டஜன்'
  });
  // rupee words. A number next to one of these is an AMOUNT in rupees, never a weight.
  var CURRENCY = {};
  ('rs rupee rupees rupai rupais rupay rubai rubais rubay ruba rupa rupaa rubaa rupaiku rubaiku rupayku ' +
   'ரூபாய் ரூபா ரூ ருபாய் ரூபாய்க்கு ரூபாக்கு').split(' ').forEach(function (w) { CURRENCY[skeleton(w)] = 1; });
  function isCur(t) { return CURRENCY[skeleton(t)] === 1; }
  var FILLER = {};
  ('pannu podu podunga poduga add venum venumnu vendum kodunga kudunga thanga thaanga tharunga mattrum matrum and um ku ' +
   'aprom apram appuram next then also vera inum innum pls please anna bro sir boss ' +
   'பண்ணு போடு வேணும் கொடுங்க மற்றும் அப்புறம்').split(' ').forEach(function (w) { FILLER[skeleton(w)] = 1; });

  var ATTACHED = /^(\d+(?:\.\d+)?)(kg|kgs|kilo|g|gm|gms|gram|grams|l|lt|ltr|litre|liter|ml|pc|pcs)$/i;

  function isNumeric(t) { return /^\d+(\.\d+)?$/.test(t); }

  // ---- quantity phrase at position i --------------------------------------
  // returns {value, unit|null, used, explicit} or null. value is in the written unit.
  function readQty(tokens, i) {
    var t = tokens[i], sk = skeleton(t), m;
    // "rs 5" / "rupees 5": currency word first, then a plain number
    if (isCur(t) && i + 1 < tokens.length) {
      var nx = tokens[i + 1], nv = isNumeric(nx) ? parseFloat(nx) : NUM[skeleton(nx)];
      if (nv !== undefined && !(i + 2 < tokens.length && UNIT[skeleton(tokens[i + 2])])) return { amount: nv, unit: null, used: 2 };
    }
    if ((m = ATTACHED.exec(t))) {
      return { value: parseFloat(m[1]), unit: unitOf(m[2]), used: 1 };
    }
    var value = null, used = 0, j = i;
    if (isNumeric(t)) { value = parseFloat(t); used = 1; j = i + 1; }
    else if (NUM[sk] !== undefined) { value = NUM[sk]; used = 1; j = i + 1; }
    else if (FRACTION[sk] !== undefined) { value = FRACTION[sk]; used = 1; j = i + 1; }
    else return null;
    // number followed by fraction: "rendu arai kilo" = 2.5 ; "oru kaal" is not 1.25
    if (j < tokens.length && FRACTION[skeleton(tokens[j])] !== undefined && NUM[sk] !== undefined && NUM[sk] < 10 && FRACTION[sk] === undefined) {
      value += FRACTION[skeleton(tokens[j])]; used++; j++;
    }
    // "5 rubai" / "anju rupees": a rupee AMOUNT. Fractions are not accepted as amounts.
    if (j < tokens.length && isCur(tokens[j])) {
      if (FRACTION[sk] !== undefined || used > 1) return { amount: null, bad: true, value: value, unit: null, used: used + 1 };
      return { amount: value, unit: null, used: used + 1 };
    }
    var unit = null;
    if (j < tokens.length && UNIT[skeleton(tokens[j])]) { unit = UNIT[skeleton(tokens[j])]; used++; }
    // bare 100-500 without unit and without fraction is a gram count only when unit says so
    return { value: value, unit: unit, used: used };
  }
  function unitOf(w) { return UNIT[skeleton(w)] || null; }

  // convert a quantity into the item's base unit. returns {qty, note|null, ok}
  function toBase(q, itemUnit) {
    var v = q.value, u = q.unit;
    if (u === 'dozen') { v = v * 12; u = 'pc'; }
    if (u === 'g') { v = v / 1000; u = 'kg'; }
    if (u === 'ml') { v = v / 1000; u = 'l'; }
    if (!u) {
      // fraction words (kaal/arai) imply the item's own unit; bare whole numbers are ambiguous
      return { qty: v, ok: true, assumed: true };
    }
    if (u === itemUnit) return { qty: v, ok: true };
    // kilo said for a litre item (e.g. "oil oru kilo") or packets for loose items: ask
    return { qty: v, ok: false, note: 'unit "' + u + '" does not match item unit "' + itemUnit + '"' };
  }

  // ---- catalog index -------------------------------------------------------
  function buildIndex(catalog) {
    var map = {}, list = [], tmap = {};
    catalog.forEach(function (it) {
      var names = [it.name, it.ta].concat(it.aliases || []);
      names.forEach(function (n) {
        if (!n) return;
        var key = tokenize(n).map(skeleton).join(' ');
        if (!key) return;
        (map[key] = map[key] || []);
        if (map[key].indexOf(it.id) < 0) map[key].push(it.id);
        list.push({ key: key, id: it.id });
        if (/[\u0B80-\u0BFF]/.test(key)) {
          var ck = tamilCanon(key);
          (tmap[ck] = tmap[ck] || []);
          if (tmap[ck].indexOf(it.id) < 0) tmap[ck].push(it.id);
        }
      });
    });
    return { map: map, list: list, tmap: tmap, byId: catalog.reduce(function (a, it) { a[it.id] = it; return a; }, {}) };
  }

  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }

  // longest n-gram (3..1) at i that matches a catalog name, exact first then fuzzy
  function matchItem(tokens, i, idx) {
    var n, key, fuzzy = null;
    for (n = Math.min(3, tokens.length - i); n >= 1; n--) {
      key = tokens.slice(i, i + n).map(skeleton).join(' ');
      if (idx.map[key]) return { ids: idx.map[key].slice(), used: n, exact: true };
    }
    // pronunciation variants: same word with confusable Tamil letters (வெள்ளம் for வெல்லம்).
    // Exactly one catalog item canonicalises to it = match. Several = candidates to confirm,
    // never a silent pick. Letters are NOT merged anywhere else (billing, display untouched).
    for (n = Math.min(3, tokens.length - i); n >= 1; n--) {
      key = tokens.slice(i, i + n).map(skeleton).join(' ');
      if (!/[\u0B80-\u0BFF]/.test(key)) continue;
      var vids = idx.tmap[tamilCanon(key)];
      if (vids) return { ids: vids.slice(), used: n, exact: true, variant: true };
    }
    // fuzzy: single/double token vs alias keys (typos, speech-recognition drift)
    var best = null;
    for (n = Math.min(2, tokens.length - i); n >= 1; n--) {
      key = tokens.slice(i, i + n).map(skeleton).join(' ');
      if (key.length < 4 || /[\u0B80-\u0BFF]/.test(key) && key.length < 3) continue;
      idx.list.forEach(function (e) {
        var d = lev(key, e.key), lim = key.length >= 8 ? 2 : 1;
        if (d <= lim && (!best || d < best.d || (d === best.d && n > best.used))) best = { ids: [e.id], used: n, d: d, exact: false };
      });
      if (best) { fuzzy = best; break; }
    }
    return fuzzy;
  }

  // ---- main parse ----------------------------------------------------------
  // Returns {lines:[...], warnings:[...]}. A line is:
  // {text, itemId|null, qty|null, unit, status:'ok'|'check'|'unknown'|'noqty', note, candidates:[ids]}
  function parse(text, catalog) {
    var idx = buildIndex(catalog), tokens = tokenize(text), ev = [], i = 0;
    while (i < tokens.length) {
      var t = tokens[i], sk = skeleton(t);
      if (FILLER[sk]) { i++; continue; }
      var q = readQty(tokens, i);
      var mi = matchItem(tokens, i, idx);
      // exact catalog words win over number words (e.g. an item literally named "ten")
      if (mi && mi.exact) {
        ev.push({ k: 'item', ids: mi.ids, text: tokens.slice(i, i + mi.used).join(' '), exact: true }); i += mi.used; continue;
      }
      if (q) { ev.push({ k: 'qty', q: q, text: tokens.slice(i, i + q.used).join(' ') }); i += q.used; continue; }
      if (isCur(t)) { ev.push({ k: 'cur', text: t }); i++; continue; }
      if (mi) { ev.push({ k: 'item', ids: mi.ids, text: tokens.slice(i, i + mi.used).join(' '), exact: false }); i += mi.used; continue; }
      if (UNIT[sk]) {
        // unit alone ("kilo") with no number: treat as 1 unit
        ev.push({ k: 'qty', q: { value: 1, unit: UNIT[sk], used: 1 }, text: t }); i++; continue;
      }
      // unknown word(s): merge with previous unknown
      var last = ev[ev.length - 1];
      if (last && last.k === 'unk') { last.text += ' ' + t; } else ev.push({ k: 'unk', text: t });
      i++;
    }

    var qtyFirst = ev.length && ev[0].k === 'qty';
    var used = {}, lines = [], p;
    function mk(item, qev) { return { item: item, qev: qev }; }
    for (p = 0; p < ev.length; p++) {
      if (used[p]) continue;
      var e = ev[p];
      if (e.k === 'qty' || e.k === 'cur') continue; // consumed by an item or reported below
      var qi = -1;
      if (qtyFirst) { if (p > 0 && ev[p - 1].k === 'qty' && !used[p - 1]) qi = p - 1; }
      else if (p + 1 < ev.length && ev[p + 1].k === 'qty' && !used[p + 1]) qi = p + 1;
      else if (p > 0 && ev[p - 1].k === 'qty' && !used[p - 1]) qi = p - 1;
      if (qi >= 0) used[qi] = 1;
      used[p] = 1;
      lines.push(buildLine(e, qi >= 0 ? ev[qi] : null, idx));
    }
    var warnings = [];
    ev.forEach(function (e, k) {
      if (e.k === 'qty' && !used[k]) warnings.push((e.q.amount != null ? 'Amount "' : 'Quantity "') + e.text + '" has no item');
      if (e.k === 'cur') warnings.push('"' + e.text + '" heard without a clear amount. Say or type it like "5 rubai".');
    });
    return { lines: lines, warnings: warnings, tokens: tokens };
  }

  function buildLine(e, qe, idx) {
    var L = { text: e.text + (qe ? ' ' + qe.text : ''), itemId: null, qty: null, unit: null, status: 'ok', note: '', candidates: [] };
    if (e.k === 'unk') {
      L.status = 'unknown'; L.name = e.text;
      if (qe) {
        L.qtyText = qe.text;
        // a heard rupee amount survives item resolution: kept on the line and applied to
        // whichever item the shopkeeper picks, so "வெள்ளம் 10 rs" never loses its Rs 10.
        if (qe.q.amount !== undefined && !qe.q.bad && qe.q.amount > 0) { L.amount = qe.q.amount; L.amountBased = true; }
        else if (qe.q.amount !== undefined || qe.q.bad) L.badAmount = true;
      }
      L.note = 'Item not in catalog: "' + e.text + '". Add it to the catalog or pick one.' +
        (L.amount ? ' The Rs ' + L.amount + ' is kept and will apply to the item you pick.' : '') +
        (L.badAmount ? ' The rupee amount was not clear; type it in the Rs box.' : '');
      return L;
    }
    L.candidates = e.ids.slice();
    L.itemId = e.ids[0];
    var item = idx.byId[L.itemId];
    L.name = item.name; L.unit = item.unit;
    if (e.ids.length > 1) { L.status = 'check'; L.note = 'Which item? Several match "' + e.text + '".'; }
    else if (!e.exact) { L.status = 'check'; L.note = 'Heard "' + e.text + '", matched ' + item.name + '. Please confirm.'; }
    if (!qe) {
      L.status = L.status === 'ok' ? 'noqty' : L.status; L.qty = null;
      L.note = (L.note ? L.note + ' ' : '') + 'Quantity not heard.';
      return L;
    }
    if (qe.q.amount !== undefined) {
      var a = qe.q.amount;
      if (qe.q.bad || !(a > 0)) { L.status = 'check'; L.note = (L.note ? L.note + ' ' : '') + 'Could not read the rupee amount "' + qe.text + '". Type the amount.'; return L; }
      L.amount = a; L.amountBased = true; L.qty = null;
      L.status = L.status === 'noqty' ? 'ok' : L.status;
      if (item.unit === 'pc') { L.status = 'check'; L.note = (L.note ? L.note + ' ' : '') + 'Rs amount for a piece item: no quantity will be recorded. Please confirm or enter pieces.'; }
      if (a > 500) { L.status = 'check'; L.note = (L.note ? L.note + ' ' : '') + 'Large amount Rs ' + a + '. Please confirm.'; }
      return L;
    }
    var r = toBase(qe.q, item.unit);
    L.qty = Math.round(r.qty * 1000) / 1000;
    if (!r.ok) { L.status = 'check'; L.note = (L.note ? L.note + ' ' : '') + r.note + '. Please confirm.'; }
    else if (r.assumed && qe.q.value >= 1 && FRACTION[skeleton(qe.text.split(' ')[0])] === undefined) {
      L.status = 'check'; L.note = (L.note ? L.note + ' ' : '') + 'No unit heard; assumed ' + item.unit + '. Please confirm.';
    }
    return L;
  }

  var api = { parse: parse, skeleton: skeleton, tamilCanon: tamilCanon, tokenize: tokenize, buildIndex: buildIndex, lev: lev };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VoiceParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
