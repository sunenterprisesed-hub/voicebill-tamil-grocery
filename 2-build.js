'use strict';
// Builds static, server-less versions of the app (data kept in the browser's localStorage).
//   dist/standalone/voicebill.html  - one self-contained file
//   dist/site/                      - same app as plain static files (for any https static host)
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const P = __dirname; const D = path.join(__dirname, 'dist');
const rd = (f) => fs.readFileSync(path.join(P, f), 'utf8');
fs.rmSync(D, { recursive: true, force: true }); fs.mkdirSync(path.join(D, 'standalone'), { recursive: true }); fs.mkdirSync(path.join(D, 'site'), { recursive: true });
const scripts = ['seed.js', 'billing-core.js', 'summary-core.js', 'parser.js', 'mode.js', 'app.js'];
const src = Object.fromEntries(scripts.map((f) => [f, rd(f)]));
src['mode.js'] = 'window.VB_LOCAL_MODE = true;\n';
const meta = (extra) => '<meta http-equiv="Content-Security-Policy" content="' + extra + '">';
const common = "default-src 'none'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
// single file
let html = rd('index.html');
const hashes = [];
const body = scripts.map((f) => { const code = src[f]; hashes.push("'sha256-" + crypto.createHash('sha256').update(code).digest('base64') + "'"); return code; });
const css = rd('style.css'); const cssHash = "'sha256-" + crypto.createHash('sha256').update(css).digest('base64') + "'";
html = html.replace(/<script src="[^"]+"><\/script>\n?/g, '').replace('<link rel="stylesheet" href="style.css">', meta(common + '; style-src ' + cssHash + '; script-src ' + hashes.join(' ')) + '\n<style>' + css + '</style>');
html = html.replace('</body>', body.map((c) => '<script>' + c + '</script>').join('\n') + '\n</body>');
fs.writeFileSync(path.join(D, 'standalone', 'voicebill.html'), html);
// static site
let site = rd('index.html').replace('<link rel="stylesheet" href="style.css">', meta(common + "; style-src 'self'; script-src 'self'") + '\n<link rel="stylesheet" href="style.css">');
fs.writeFileSync(path.join(D, 'site', 'index.html'), site);
fs.writeFileSync(path.join(D, 'site', 'style.css'), css);
scripts.forEach((f) => fs.writeFileSync(path.join(D, 'site', f), src[f]));
console.log('built', fs.statSync(path.join(D, 'standalone', 'voicebill.html')).size, 'bytes single file');
