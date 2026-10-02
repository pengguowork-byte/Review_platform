'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive:true }); fs.writeFileSync(path.join(root, p), s); };
const manifest = JSON.parse(read('data/library.json'));
manifest.subjects = manifest.subjects.map(({ contentHtml, navigationHtml, ...s }) => {
  if (s.source) return s;
  write('data/subjects/' + s.id + '.json', JSON.stringify({ contentHtml, navigationHtml }, null, 2));
  return { ...s, source: 'data/subjects/' + s.id + '.json' };
});
write('data/library.json', JSON.stringify(manifest, null, 2));
let extraction = read('assets/js/extraction.js');
function split(first, last, name, args, exports) {
  const start = extraction.indexOf(first), end = extraction.indexOf(last, start);
  if (start < 0 || end < 0) throw new Error(name);
  const code = extraction.slice(start, end);
  write('assets/js/' + name + '.js', 'window.' + name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + ' = function (ctx) {\n' +
    args.map(n => '  var ' + n + ' = ctx.' + n + ';').join('\n') + '\n' + code + '\nreturn { ' + exports.join(', ') + ' };\n};\n');
  const factory = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  extraction = extraction.slice(0, start) + '  var ' + factory + ' = window.' + factory + '({ ' + args.join(', ') + ' });\n' +
    exports.map(n => '  var ' + n + ' = ' + factory + '.' + n + ';').join('\n') + '\n\n' + extraction.slice(end);
}
split('  function idbOpen()', '  function loadScript(', 'extract-storage', ['st', 'DB_NAME', 'DB_VERSION'], ['idbOpen', 'idbAll', 'idbPut', 'idbPutAll', 'idbDelete', 'idbClearAll']);
split('  function loadScript(', '  function fileById(', 'extract-parsers', ['st', 'CDN', 'ACCEPT', 'MAX_SIZE', 'OCR_PAGE_LIMIT', 'OCR_TRIGGER', 'OCR_DPI', 'CHUNK_SIZE', 'log'], ['loadScript', 'validateFile', 'extractPdf', 'extractDocx', 'extractImages', 'buildChunks']);
split('  function tsName()', '  function bind()', 'extract-exports', ['st', '$', 'toast', 'fileNameOf', 'pageLabelOf', 'loadScript', 'CDN'], ['exportJson', 'exportCsv', 'exportXlsx']);
write('assets/js/extraction.js', extraction);
let page = read('index.html');
page = page.replace('<input id="libraryFile"', '<button class="btn" id="libraryPasteBtn">粘贴题库</button><input id="libraryFile"');
page = page.replace('      <div class="toolbar">', '<div class="library-paste" id="libraryPastePanel" hidden><label for="libraryPasteText">粘贴题库 JSON（导入后刷新页面，同 ID 专题会更新）</label><textarea id="libraryPasteText" placeholder="粘贴 JSON 题库内容"></textarea><button class="btn" id="libraryPasteConfirm">确认导入题库</button></div>\n      <div class="toolbar">');
page = page.replace('<script src="assets/js/extraction.js">', ['extract-storage', 'extract-parsers', 'extract-exports'].map(n => '<script src="assets/js/' + n + '.js"></script>').join('\n') + '\n<script src="assets/js/extraction.js">');
write('index.html', page);
console.log('Split subject data, IndexedDB, parsers and export modules.');
