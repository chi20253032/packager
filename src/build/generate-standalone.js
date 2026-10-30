const pathUtil = require('path');
const fs = require('fs');

const dist = pathUtil.join(__dirname, '..', '..', 'dist');
console.log('dist: ' + dist);

const makeSafeForInlineScript = (content) => content.replace(/<\/script/gi, '<\\/script');

const readAsset = (relativePath, description) => {
  const normalized = relativePath.split(/[?#]/, 1)[0];
  const decoded = decodeURIComponent(normalized);
  if (!decoded || decoded.startsWith('/') || decoded.split(/[\\/]/).includes('..')) {
    throw new Error('Unsafe ' + description + ' path: ' + relativePath);
  }
  const absolutePath = pathUtil.resolve(dist, decoded);
  if (!absolutePath.startsWith(dist + pathUtil.sep)) {
    throw new Error('Asset escaped dist directory: ' + relativePath);
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error('Missing ' + description + ': ' + relativePath);
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const mobileCSS = [
  '/* Single-file Packager mobile layout */',
  '*, *::before, *::after { box-sizing: border-box; }',
  'html { min-width: 320px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }',
  'body { margin: 0; padding: max(8px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left)); }',
  '#app, main { width: 100%; min-width: 0; }',
  'main { padding-bottom: 16px; }',
  '.card { width: 100%; max-width: 625px; min-width: 0; margin-left: auto; margin-right: auto; overflow-wrap: anywhere; }',
  'button, input, select, textarea { max-width: 100%; font: inherit; }',
  'button, input[type="button"], input[type="submit"], select { min-height: 42px; }',
  'input[type="checkbox"], input[type="radio"] { width: 20px; height: 20px; vertical-align: middle; }',
  'input[type="text"], input[type="number"], input[type="url"], input[type="file"], select, textarea { max-width: 100%; min-width: 0; padding: 9px 10px; border-radius: 7px; font-size: 16px; }',
  'textarea { width: 100%; min-width: 0; }',
  'img, video, canvas, svg { max-width: 100%; }',
  'button, a, summary, label { touch-action: manipulation; }',
  ':focus-visible { outline: 3px solid #4c97ff; outline-offset: 2px; }',
  '@media (max-width: 640px) {',
  '  body { padding-left: max(8px, env(safe-area-inset-left)); padding-right: max(8px, env(safe-area-inset-right)); }',
  '  h1 { font-size: clamp(1.55rem, 7vw, 2rem); }',
  '  h2 { font-size: 1.25rem; }',
  '  .card { padding: 12px; margin-top: 10px; margin-bottom: 10px; border-radius: 10px; }',
  '  .option { gap: 6px; }',
  '  .option input[type="text"], .option input[type="number"], .option input[type="file"], .option select, .group input[type="text"], .group select { width: 100% !important; max-width: 100%; margin-left: 0; }',
  '  input[type="text"], input[type="number"] { width: 100%; }',
  '  .buttons { display: flex; flex-wrap: wrap; gap: 8px; }',
  '  .buttons > .button, .buttons > div { margin: 0; }',
  '  .buttons button { min-height: 44px; }',
  '  .side-buttons { margin-left: 0; }',
  '  details { max-width: 100%; }',
  '  details > * { min-width: 0; }',
  '  footer { padding: 8px 0 max(8px, env(safe-area-inset-bottom)); line-height: 2; overflow-wrap: anywhere; }',
  '  footer a { display: inline-block; padding: 4px 2px; }',
  '  .reset { margin-left: 8px; }',
  '}',
  '@media (max-width: 380px) {',
  '  .card { padding: 10px; }',
  '  .buttons > .button { flex: 1 1 100%; }',
  '  .buttons button { width: 100%; }',
  '}'
].join('\n');

const indexPath = pathUtil.join(dist, 'index.html');
console.log('index.html: ' + indexPath);
let html = fs.readFileSync(indexPath, 'utf8');

const scaffoldingDirectory = pathUtil.join(dist, 'scaffolding');
if (!fs.existsSync(scaffoldingDirectory)) {
  throw new Error('Missing dist/scaffolding. Run the standalone webpack build first.');
}
const scaffoldingAssets = {};
for (const filename of fs.readdirSync(scaffoldingDirectory).filter(name => name.endsWith('.js')).sort()) {
  if (filename.includes('extension-worker')) continue;
  const relativePath = 'scaffolding/' + filename;
  scaffoldingAssets[relativePath] = fs.readFileSync(pathUtil.join(scaffoldingDirectory, filename), 'utf8');
}
if (!Object.keys(scaffoldingAssets).some(name => name.includes('scaffolding-min'))) {
  throw new Error('The minimal scaffolding bundle was not generated.');
}
console.log('scaffolding assets: ' + Object.keys(scaffoldingAssets).join(', '));

let inlineScaffolding = Object.entries(scaffoldingAssets).map(([name, content]) => (
  '<script type="p4-standalone-asset" data-name="' + name + '">' +
  makeSafeForInlineScript(content) +
  '</script>'
)).join('\n');
inlineScaffolding += '<script>\n' +
  'window.__ASSETS__ = {};\n' +
  'for (const el of Array.from(document.querySelectorAll(\'script[type="p4-standalone-asset"]\'))) {\n' +
  '  window.__ASSETS__[el.dataset.name] = el.textContent;\n' +
  '  el.remove();\n' +
  '}\n' +
  '</script>';

const firstBundleTag = html.search(/<script\b[^>]*\bsrc\s*=/i);
if (firstBundleTag < 0) {
  throw new Error('Cannot locate the first JavaScript bundle tag.');
}
html = html.slice(0, firstBundleTag) + inlineScaffolding + '\n' + html.slice(firstBundleTag);

let inlinedScripts = 0;
html = html.replace(/<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi, (_match, before, _quote, src, after) => {
  const script = readAsset(src, 'JavaScript bundle');
  const attributes = (before + ' ' + after)
    .replace(/\s(?:async|defer|integrity|crossorigin)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')
    .trim();
  inlinedScripts++;
  return '<script' + (attributes ? ' ' + attributes : '') + '>\n' +
    makeSafeForInlineScript(script) +
    '\n</script>';
});
if (!inlinedScripts) {
  throw new Error('No external JavaScript bundles were found in dist/index.html.');
}

let inlinedStylesheets = 0;
html = html.replace(/<link\b([^>]*)>/gi, (match, attributes) => {
  const rel = (attributes.match(/\brel\s*=\s*(["'])(.*?)\1/i) || [])[2] || '';
  const href = (attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i) || [])[2];
  if (!href || !rel.toLowerCase().split(/\s+/).includes('stylesheet')) return match;
  const css = readAsset(href, 'stylesheet');
  inlinedStylesheets++;
  return '<style>\n' + css.replace(/<\/style/gi, '<\\/style') + '\n</style>';
});

html = html.replace(/<\/head>/i, '<style id="p4-standalone-mobile">' + mobileCSS + '</style>\n</head>');

const faviconPath = pathUtil.join(__dirname, '../../static/favicon.ico');
if (fs.existsSync(faviconPath)) {
  const faviconData = fs.readFileSync(faviconPath);
  html = html.replace(/<\/head>/i, '<link rel="icon" href="data:image/vnd.microsoft.icon;base64,' +
    faviconData.toString('base64') + '">\n</head>');
}

// Inspect actual opening tags only. Bundle source can contain HTML-like strings
// such as "<script src=..." which must not be mistaken for document tags.
// Ignore inline script bodies while inspecting document markup. JavaScript bundles
// can legitimately contain strings that look like HTML tags.
const markupOnly = html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2');
const openingTags = markupOnly.match(/<(?:script|link)\b[^>]*>/gi) || [];
const externalScriptTags = openingTags.filter(tag => /^<script\b/i.test(tag) && /\bsrc\s*=/i.test(tag));
const externalStylesheetLinks = openingTags.filter(tag =>
  /^<link\b/i.test(tag) &&
  /\brel\s*=\s*(["'])[^"']*\bstylesheet\b[^"']*\1/i.test(tag) &&
  /\bhref\s*=/i.test(tag)
);
if (externalScriptTags.length || externalStylesheetLinks.length) {
  throw new Error('Standalone output still contains external script or stylesheet references: ' +
    [...externalScriptTags, ...externalStylesheetLinks].join(' | '));
}

const standalonePath = pathUtil.join(dist, 'standalone.html');
fs.writeFileSync(standalonePath, html);
const sizeMB = (Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2);
console.log('standalone.html: ' + standalonePath + ' (' + sizeMB + ' MiB)');
console.log('inlined ' + inlinedScripts + ' JavaScript bundle(s) and ' + inlinedStylesheets + ' stylesheet(s); mobile layout enabled.');
