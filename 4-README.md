# Voice Bill - Tamil/Tanglish voice billing for small grocery shops (prototype)

Say a list like "poondu kaal kilo, arisi rendu kilo". The app maps the words to items in the shop's own catalog, works out quantities (kaal = 1/4, arai = 1/2, mukkaal = 3/4), prices them from the catalog and builds a bill. Nothing is added to a final bill until every line is clear or confirmed.

## Run

One command with Docker (no keys, no secrets, no npm install):

    docker compose up    # then open http://localhost:8787

The app starts and shows its main screen without any secret keys - it uses no third-party
API keys at all. Prices come from the app's own catalog, speech recognition is the browser's
built-in service.

Or with plain Node 18+ (also no packages to install):

    npm start            # server version: http://127.0.0.1:8787
    npm test             # parser, pricing, summary, sharing, API and security checks
    npm run build        # static versions in dist/: dist/standalone/voicebill.html (one file) and dist/site/ (for any https static host); data stays in the browser (localStorage)

Inside a container the server binds 0.0.0.0 via BIND_ALL=1 (the port mapping controls exposure).
Outside a container it still refuses to listen on a network address without APP_TOKEN.

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

## New in Round 2 (27-30 Nov)
- **Day summary tab**: pick a day, see bill count, total and average sales, top-selling item and per-item quantities. Undo-last-line makes fixing a misheard item one tap. Share the summary on WhatsApp as ready-to-send text.
- **Read total aloud**: optional voice-out of the finalized total (Tamil or English, matching the mic language), so the shopkeeper hears the bill.
- **Send bill on WhatsApp**: every finalized receipt gets a wa.me link with the receipt as text (receipt only, not a GST tax invoice). The shopkeeper picks the contact inside WhatsApp; nothing is uploaded.
- **Docker one-command start**: Dockerfile + docker-compose.yml; the app comes up key-free.
- Layout fix: the browser files live in the repo root (that is what GitHub Pages serves); the Node server serves exactly those whitelisted files and nothing else, and tests cover that.

## Layout (flat: the repo root IS the static site)
    index.html, style.css, app.js   UI (GitHub Pages serves these)
    parser.js                       Tamil/Tanglish parser (browser + Node)
    billing-core.js                 catalog validation, pricing, CSV, Tally draft (browser + Node)
    summary-core.js                 day summary + WhatsApp share text (browser + Node)
    seed.js                         SAMPLE catalog
    mode.js                         static-hosting flag (the server overrides it to server mode)
    server/                         HTTP server, JSON store
    test/                           automated tests
    Dockerfile, docker-compose.yml  one-command start

## Hackathon provenance (India Runs on Voice, Scaler x Wispr Flow)
First working version built 13-14 Nov 2026 during Round 1. Extended 27-28 Nov 2026 during the
Round 2 build window with the Round 2 features above (see git history). All code in this repo is
original project code, not a starter template.
