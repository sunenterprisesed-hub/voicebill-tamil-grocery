# Voice Bill - Tamil/Tanglish voice billing for small grocery shops (prototype)

Say a list like "poondu kaal kilo, arisi rendu kilo". The app maps the words to items in the shop's own catalog, works out quantities (kaal = 1/4, arai = 1/2, mukkaal = 3/4), prices them from the catalog and builds a bill. Nothing is added to a final bill until every line is clear or confirmed.

## Run (Node 18+ only, no packages to install)
    npm start            # server version: http://127.0.0.1:8787
    npm test             # 27 tests: parser, pricing, API, security checks
    npm run build        # static versions in dist/: dist/standalone/voicebill.html (one file) and dist/site/ (for any https static host); data stays in the browser (localStorage)

## What it does
- Voice entry (Chrome/Edge): the browser's speech service turns Tamil (ta-IN) or English (en-IN) speech into text. You can edit the text before adding. Typing works everywhere.
- Parser: Tanglish and Tamil-letter words, number words (oru, rendu, moonu...), fractions, grams/kilo/litre/packet/dozen, either order ("poondu kaal kilo" or "kaal kilo poondu").
- Catalog: 38 SAMPLE items with placeholder prices, clearly flagged. Editing a price removes the flag. Add items and aliases in the Catalog tab.
- Safety: prices come only from the catalog and are recomputed on the server. Unknown items, missing quantities, ambiguous words ("paruppu"), unit mismatches (a kilo of oil) and spelling guesses all need a fix or a tap to confirm.
- Bills, history, CSV export, print/save as PDF. Receipts say "not a GST tax invoice".
- ERP: only a DRAFT Tally sales-voucher XML file per bill. It is not tested with TallyPrime and nothing is ever sent to accounting software. A live connection needs the shop's actual software, its access and testing.

## Honest limits
- Real Tamil speech accuracy has NOT been measured on real shop audio. Dictionary words and spellings need tuning with a Tamil-speaking shopkeeper. Use the Catalog aliases to add how people really say things.
- The mic needs https or localhost. On a phone over plain http (for example http://192.168.x.x) Chrome blocks the microphone. Use it on a laptop at localhost, or serve it over https.
- Browser speech recognition sends audio to the browser vendor's service (Chrome: Google). No API keys are used or stored.
- Data (catalog, bills) is stored in data/*.json on the machine running the server. No login. By default the server only listens on 127.0.0.1; to expose it on a network you must set APP_TOKEN (the server refuses otherwise).
- Prototype: no GST handling, no stock, no multi-shop accounts.

## Layout
    public/parser.js      Tamil/Tanglish parser (also runs in the browser)
    public/app.js         UI
    server/               HTTP server, JSON store, pricing, CSV, Tally draft
    test/                 automated tests
