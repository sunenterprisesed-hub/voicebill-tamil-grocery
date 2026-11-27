'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../parser.js');
const catalog = require('../server/catalog.seed.js');
const run = (s) => P.parse(s, catalog).lines;
const one = (s) => run(s)[0];

test('poondu kaal kilo -> garlic 0.25 kg', () => {
  const l = one('poondu kaal kilo'); assert.equal(l.itemId, 'garlic'); assert.equal(l.qty, 0.25); assert.equal(l.unit, 'kg'); assert.equal(l.status, 'ok');
});
test('multiple items, item-first order', () => {
  const l = run('poondu kaal kilo, arisi rendu kilo, thakkali arai kilo');
  assert.deepEqual(l.map((x) => [x.itemId, x.qty, x.status]), [['garlic', 0.25, 'ok'], ['rice', 2, 'ok'], ['tomato', 0.5, 'ok']]);
});
test('quantity-first order', () => {
  const l = run('oru kilo arisi arai kilo poondu mukkaal kilo thakkali');
  assert.deepEqual(l.map((x) => [x.itemId, x.qty]), [['rice', 1], ['garlic', 0.5], ['tomato', 0.75]]);
});
test('Tamil script', () => {
  const l = run('பூண்டு கால் கிலோ அரிசி இரண்டு கிலோ');
  assert.deepEqual(l.map((x) => [x.itemId, x.qty, x.status]), [['garlic', 0.25, 'ok'], ['rice', 2, 'ok']]);
});
test('digits and grams', () => {
  const l = run('poondu 250 gram arisi 1.5kg sakkarai 500g');
  assert.deepEqual(l.map((x) => [x.itemId, x.qty]), [['garlic', 0.25], ['rice', 1.5], ['sugar', 0.5]]);
});
test('compound fractions and hundreds of grams', () => {
  assert.equal(one('arisi rendu arai kilo').qty, 2.5);
  assert.equal(one('arisi ondrara kilo').qty, 1.5);
  assert.equal(one('jeeragam irunooru gram').qty, 0.2);
});
test('pieces and dozen', () => {
  assert.equal(one('muttai oru dozen').qty, 12);
  assert.equal(one('thengai moonu').qty, 3); assert.equal(one('thengai moonu').unit, 'pc');
});
test('ambiguous alias needs a choice, never guessed silently', () => {
  const l = one('paruppu oru kilo'); assert.equal(l.status, 'check'); assert.ok(l.candidates.length > 3);
});
test('unknown item is flagged, not priced', () => {
  const l = run('poondu kaal kilo kollu kaal kilo'); assert.equal(l[1].status, 'unknown'); assert.equal(l[1].itemId, null);
});
test('missing quantity is flagged', () => { assert.equal(one('poondu').status, 'noqty'); });
test('wrong unit for item is flagged (kilo of oil)', () => { const l = one('sunflower oil oru kilo'); assert.equal(l.status, 'check'); });
test('spelling variants and typos fall back to confirmation', () => {
  const l = one('pondu kaal kilo'); assert.equal(l.itemId, 'garlic'); assert.equal(l.status, 'check');
  assert.equal(one('arrisi rendu keelo').itemId, 'rice');
});
test('fillers ignored', () => { assert.deepEqual(run('anna poondu kaal kilo podunga').map((x) => x.itemId), ['garlic']); });
test('quantity with no item is a warning', () => { assert.ok(P.parse('rendu kilo', catalog).warnings.length === 1); });
test('empty input', () => { assert.deepEqual(run(''), []); });

// ---- rupee amounts and spoken aliases (user phone test, Nov 14) ----
const B = require('../billing-core.js');
const am = (s) => run(s).map((x) => [x.itemId, x.qty, x.amount === undefined ? null : x.amount, x.status]);
test('"Karuveppilai 5 rubai" is Rs 5 worth of curry leaves, not 5 kg, and "rubai" is not an item', () => {
  const r = P.parse('Karuveppilai 5 rubai', catalog);
  assert.deepEqual(r.lines.map((x) => [x.itemId, x.qty, x.amount, x.status]), [['curry-leaves', null, 5, 'ok']]);
  assert.equal(r.lines.length, 1); assert.deepEqual(r.warnings, []);
});
test('rupee spellings, Tamil script, symbols, glued forms, number words, prefix form', () => {
  for (const s of ['karuveppilai 5 rupees', 'karuveppilai anju rubai', 'கருவேப்பிலை 5 ரூபாய்', 'கறிவேப்பிலை ஐந்து ரூபாய்', 'karuveppilai ₹5', 'karuveppilai rs 5', 'karuveppilai rs.5', 'karuveppilai 5rs', 'karuveppilai 5 rubaiku', '5 rubai karuveppilai', 'karuveppilai 5 ரூபாய்க்கு'])
    assert.deepEqual(am(s), [['curry-leaves', null, 5, 'ok']], s);
});
test('several amount lines and mixed with weights', () => {
  assert.deepEqual(am('karuveppilai 5 rubai kothamalli 10 rubai poondu kaal kilo'), [['curry-leaves', null, 5, 'ok'], ['coriander-leaves', null, 10, 'ok'], ['garlic', 0.25, null, 'ok']]);
  assert.deepEqual(am('thakkali rs 10 poondu kaal kilo'), [['tomato', null, 10, 'ok'], ['garlic', 0.25, null, 'ok']]);
  assert.deepEqual(am('thakkali rs.10.50'), [['tomato', null, 10.5, 'ok']]);
});
test('amount edge cases: no item, bare currency word, fraction, huge, piece item are never silently priced', () => {
  assert.equal(P.parse('5 rubai', catalog).warnings.length, 1);
  const bare = P.parse('rubai', catalog); assert.equal(bare.lines.length, 0); assert.equal(bare.warnings.length, 1);
  assert.equal(one('karuveppilai arai rubai').status, 'check');
  assert.equal(one('karuveppilai 2000 rubai').status, 'check');
  assert.equal(one('muttai 5 rubai').status, 'check');
});
test('bare number with no unit and no rupee word is still not silently kilos', () => {
  const l = one('karuveppilai 5'); assert.equal(l.status, 'check'); assert.equal(l.amount, undefined);
});
test('spoken sugar names map to sugar (Roman and Tamil script)', () => {
  for (const s of ['chakra oru kilo', 'chakkarai oru kilo', 'sarkarai oru kilo', 'sakkarai oru kilo', 'seeni oru kilo', 'சக்கரை ஒரு கிலோ', 'சர்க்கரை ஒரு கிலோ', 'சீனி ஒரு கிலோ'])
    assert.deepEqual(am(s), [['sugar', 1, null, 'ok']], s);
});
test('curry leaves spelling variants incl. Tamil script', () => {
  for (const s of ['karuveppilai 5 rubai', 'kariveppilai 5 rubai', 'கறிவேப்பிலை 5 ரூபாய்', 'கருவேப்பிலை 5 ரூபாய்', 'கருவேப்பில்லை 5 ரூபாய்'])
    assert.equal(one(s).itemId, 'curry-leaves', s);
});
test('existing kg/g/litre parsing unchanged next to amounts', () => {
  assert.deepEqual(am('arisi rendu kilo karuveppilai 5 rubai sakkarai 500g'), [['rice', 2, null, 'ok'], ['curry-leaves', null, 5, 'ok'], ['sugar', 0.5, null, 'ok']]);
});
test('amount lines price exactly the amount; qty derived only from a kg/l catalog price', () => {
  const r = B.priceBill([{ itemId: 'curry-leaves', amount: 5 }, { itemId: 'egg', amount: 5 }, { itemId: 'rice', qty: 2 }], catalog).bill;
  assert.equal(r.lines[0].amount, 5); assert.equal(r.lines[0].qty, 0.05); assert.equal(r.lines[0].amountBased, true);
  assert.equal(r.lines[1].amount, 5); assert.equal(r.lines[1].qty, null);
  assert.equal(r.total, 130);
});
test('amount validation: both qty+amount, zero, negative, 3 decimals, huge, NaN rejected', () => {
  for (const l of [{ itemId: 'rice', amount: 5, qty: 1 }, { itemId: 'rice', amount: 0 }, { itemId: 'rice', amount: -5 }, { itemId: 'rice', amount: 5.123 }, { itemId: 'rice', amount: 1e9 }, { itemId: 'rice', amount: 'x' }])
    assert.ok(B.priceBill([l], catalog).error, JSON.stringify(l));
  assert.equal(B.priceBill([{ itemId: 'rice', amount: 0.1 + 0.2 }], catalog).bill.total, 0.3);
});
test('CSV and Tally keep amount lines consistent', () => {
  const bill = Object.assign({ no: 1, ts: '2026-11-14T00:00:00Z' }, B.priceBill([{ itemId: 'curry-leaves', amount: 5 }, { itemId: 'egg', amount: 5 }], catalog).bill);
  const csv = B.toCsv([bill]).split('\n');
  assert.match(csv[0], /basis$/); assert.match(csv[1], /"0.05","kg".*"5".*amount \(qty derived\)/); assert.match(csv[2], /"","pc"/);
  const x = B.toTallyXml(bill); assert.ok(!/null/.test(x)); assert.match(x, /<BILLEDQTY>0.05 kg/); assert.equal((x.match(/BILLEDQTY>/g) || []).length, 2);
});

// ---- Tamil letter variants (user phone test, Nov 14 PM): வெள்ளம் heard for வெல்லம் ----
test('jaggery pronunciation variants match, amount intact (ழ/ல recogniser mix-up)', () => {
  for (const s of ['வெள்ளம் 10 rs', 'வெள்ளம்10rs', 'வெள்ளம் 10 ரூபாய்', 'வெள்ளம் பத்து ரூபாய்', 'வெல்லம் 10 rs', 'வெல்லாம் 10 rs'])
    assert.deepEqual(am(s), [['jaggery', null, 10, 'ok']], s);
  assert.deepEqual(am('வெள்ளம் ஐம்பது ரூபாய்'), [['jaggery', null, 50, 'ok']]);
  assert.deepEqual(am('வெள்ளம் கால் கிலோ'), [['jaggery', 0.25, null, 'ok']]);
});
test('variant matching uses confusables ழ/ல, ண/ன, ற/ர but never merges other letters', () => {
  const cat = [{ id: 'a', name: 'A', ta: 'வெல்லம்', unit: 'kg', price: 10, aliases: [] }];
  assert.equal(P.parse('வெள்ளம் ஒரு கிலோ', cat).lines[0].itemId, 'a');
  assert.equal(P.parse('வெல்லம் ஒரு கிலோ', cat).lines[0].itemId, 'a');
  // extra letter is not a silent variant: fuzzy match requires confirmation
  const extra = P.parse('வெல்லம்ம ஒரு கிலோ', cat).lines[0];
  assert.equal(extra.itemId, 'a'); assert.equal(extra.status, 'check');
});
test('ambiguous letter variant asks which item, never silently picks', () => {
  // கலரி / களறி canonicalise to the same form; a heard spelling that is exactly
  // neither (கலறி) must ask which item. An exact catalog spelling still wins directly.
  const cat = [
    { id: 'a', name: 'Kalari one', ta: 'கலரி', unit: 'kg', price: 10, aliases: [] },
    { id: 'b', name: 'Kalari two', ta: 'களறி', unit: 'kg', price: 20, aliases: [] },
  ];
  const l = P.parse('கலறி ஒரு கிலோ', cat).lines[0];
  assert.equal(l.status, 'check'); assert.deepEqual(l.candidates.slice().sort(), ['a', 'b']);
  assert.equal(P.parse('கலரி ஒரு கிலோ', cat).lines[0].itemId, 'a');
  assert.equal(P.parse('கலரி ஒரு கிலோ', cat).lines[0].status, 'ok');
});
test('exact catalog spelling still wins over variant matching', () => {
  const l = one('வெல்லம் 10 rs'); assert.equal(l.itemId, 'jaggery'); assert.equal(l.status, 'ok');
});
test('glued recogniser output splits letters and digits', () => {
  assert.deepEqual(am('karuveppilai5rs'), [['curry-leaves', null, 5, 'ok']]);
  assert.deepEqual(am('arisi2kilo'), [['rice', 2, null, 'ok']]);
  assert.deepEqual(am('sakkarai 500g'), [['sugar', 0.5, null, 'ok']]);
});
test('unknown item keeps its heard rupee amount through resolution', () => {
  const l = one('சாக்லேட் 15 rs');
  assert.equal(l.status, 'unknown'); assert.equal(l.itemId, null); assert.equal(l.amount, 15); assert.equal(l.amountBased, true);
  assert.match(l.note, /Rs 15 is kept/);
  // shopkeeper picks an item -> same line prices exactly Rs 15
  const bill = B.priceBill([{ itemId: 'biscuit', amount: l.amount }], catalog).bill;
  assert.equal(bill.lines[0].amount, 15); assert.equal(bill.lines[0].amountBased, true);
});
test('unclear amount on unknown item asks for the amount, not silently dropped', () => {
  const l = one('சாக்லேட் arai rubai');
  assert.equal(l.status, 'unknown'); assert.equal(l.amount, undefined); assert.match(l.note, /rupee amount was not clear/);
});
test('resolved jaggery Rs 10 line: pricing, CSV basis and Tally stay consistent', () => {
  const bill = Object.assign({ no: 2, ts: '2026-11-14T13:00:00Z' }, B.priceBill([{ itemId: 'jaggery', amount: 10 }], catalog).bill);
  const l = bill.lines[0];
  assert.equal(l.amount, 10); assert.equal(l.amountBased, true); assert.equal(l.qty, 0.143); assert.equal(l.samplePrice, true);
  assert.match(B.toCsv([bill]).split('\n')[1], /"0.143","kg","70","10".*amount \(qty derived\)/);
  const x = B.toTallyXml(bill); assert.match(x, /<BILLEDQTY>0.143 kg/); assert.ok(!/null/.test(x));
});
test('mergeSeedAliases adds new seed aliases, keeps prices, customs and deletions', () => {
  const seed = [{ id: 'jaggery', name: 'Jaggery', ta: 'வெல்லம்', unit: 'kg', price: 70, aliases: ['vellam', 'வெள்ளம்'] },
                { id: 'salt', name: 'Salt', ta: 'உப்பு', unit: 'kg', price: 20, aliases: ['uppu', 'salt'] }];
  const stored = [{ id: 'jaggery', name: 'Jaggery', ta: 'வெல்லம்', unit: 'kg', price: 85, sample: false, aliases: ['vellam'] }, // price edited
                  { id: 'custom-1', name: 'Appalam', ta: '', unit: 'pc', price: 5, aliases: [] }]; // salt deleted
  const m = B.mergeSeedAliases(stored, seed);
  assert.equal(m.changed, true);
  assert.deepEqual(m.catalog[0].aliases, ['vellam', 'வெள்ளம்']);
  assert.equal(m.catalog[0].price, 85); assert.equal(m.catalog[0].sample, false);
  assert.equal(m.catalog.length, 2); // deleted salt not resurrected, custom kept
  assert.equal(m.catalog[1].id, 'custom-1');
  assert.equal(B.mergeSeedAliases(m.catalog, seed).changed, false); // idempotent
  const v = B.validateCatalog(m.catalog); assert.ok(!v.error);
});
