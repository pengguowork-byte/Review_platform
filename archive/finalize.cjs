'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const replaceFunction = (text, name, body) => {
  const start = text.indexOf('  function ' + name + '(');
  const end = text.indexOf('\n  }', start) + 4;
  if (start < 0 || end < start) throw new Error(name);
  return text.slice(0, start) + body + text.slice(end);
};
let search = read('assets/js/search.js');
search = replaceFunction(search, 'filter', `  function filter(q) {
    q = q.trim().toLowerCase();
    var visibleCount = 0, categoryCount = 0;
    cards.forEach(function (card) {
      var categoryHit = window.KnowledgeLibrary.matches(card);
      if (categoryHit) categoryCount++;
      var hit = categoryHit && (!q || card.textContent.toLowerCase().indexOf(q) >= 0);
      if (window.KnowledgeReview && window.KnowledgeReview.isActive()) hit = hit && window.KnowledgeReview.isDueCard(card.id);
      card.style.display = hit ? '' : 'none';
      if (hit) visibleCount++;
      highlightTitle(card.querySelector('.q-title'), hit && q ? q : '');
    });
    count.textContent = '显示 ' + visibleCount + ' / ' + categoryCount + ' 题';
    hideEmptySections();
    document.querySelectorAll('aside [data-subject]').forEach(function (el) {
      el.hidden = !window.KnowledgeLibrary.matches(el);
    });
    document.getElementById('libraryEmpty').style.display = categoryCount ? 'none' : 'block';
    if (window.KnowledgeReview) window.KnowledgeReview.updateView(visibleCount);
    return visibleCount;
  }`);
search = search.replace("  input.addEventListener('input'", "  window.KnowledgeView = { refresh: function () { return filter(input.value); } };\n  document.addEventListener('knowledge-filter-change', window.KnowledgeView.refresh);\n  input.addEventListener('input'");
write('assets/js/search.js', search);
let ui = read('assets/js/review-ui.js');
ui = replaceFunction(ui, 'applyVerdict', `  function applyVerdict(c, level, cov, acc, manual) {
    window.ReviewEngine.apply(c, level, cov, acc, manual);
    saveDB();
  }`);
ui = ui.replace("if (!db.cards[cid]) db.cards[cid] = { level: null, reps: 0, interval: 0, ease: 2.5, due: 0, gate: 0, stage: 0, lapses: 0, quizzes: 0, restudy: false, history: [] };", 'if (!db.cards[cid]) db.cards[cid] = window.ReviewEngine.createCard();');
ui = replaceFunction(ui, 'setLevel', `  function setLevel(cid, level) {
    applyVerdict(get(cid), level || null, null, null, true);
    updateLvlBtn(cid); renderStats(); refreshPanel(cid); applyReviewMode();
  }`);
ui = replaceFunction(ui, 'applyReviewMode', `  function applyReviewMode() {
    document.body.classList.toggle('review-mode', reviewMode);
    if (window.KnowledgeView) window.KnowledgeView.refresh();
  }`);
ui = ui.replace("  // —— 全局复习模式 ——", `  window.KnowledgeReview = {
    isActive: function () { return reviewMode; },
    isDueCard: function (id) { var c = read(id); return inQueue(c) && isDue(c); },
    updateView: function (count) {
      var btn = document.getElementById('reviewModeBtn');
      btn.classList.toggle('active', reviewMode); btn.textContent = reviewMode ? '退出复习模式' : '复习模式';
      var banner = document.getElementById('reviewBanner');
      banner.textContent = '当前知识范围今日待复习 ' + count + ' 道，连续两次达到熟练后毕业。';
      banner.classList.toggle('show', reviewMode);
      document.getElementById('reviewEmpty').style.display = reviewMode && count === 0 && document.getElementById('libraryEmpty').style.display === 'none' ? 'block' : 'none';
    }
  };
  // —— 全局复习模式 ——`);
ui = ui.replace('applyReviewMode: applyReviewMode });', 'applyReviewMode: applyReviewMode, refreshLapsed: refreshLapsed, renderBasket: renderBasket, norm: norm });');
// Every state update refreshes the shared category/search/review filter.
ui = ui.replace(/if \(reviewMode\) applyReviewMode\(\);/g, 'applyReviewMode();');
ui = ui.replace('    for (var cid in db.cards) {\n      var c = db.cards[cid];', "    for (var cid in db.cards) {\n      if (!document.getElementById(cid)) continue;\n      var c = db.cards[cid];");
write('assets/js/review-ui.js', ui);
let sync = read('assets/js/sync.js');
sync = sync.replace('  var applyReviewMode = ctx.applyReviewMode;', '  var applyReviewMode = ctx.applyReviewMode, refreshLapsed = ctx.refreshLapsed, renderBasket = ctx.renderBasket, norm = ctx.norm;\n  var syncState = { pending: null, tab: "file" };');
sync = replaceFunction(sync, 'replayExtra', '  function replayExtra(base, other) {\n    return window.ReviewEngine.merge(base, other);\n  }');
sync = sync.replace('if (reviewMode) applyReviewMode();', 'applyReviewMode();');
sync = sync.replace('嵌入式八股-复习进度-', '知识工作台-复习进度-');
sync = sync.replace("      if (c && c.level && c.level !== 'unseen') cards[cid] = c;", "      if (c && (c.level || (c.history && c.history.length))) cards[cid] = c;");
sync = sync.replace('保留双方全部历史', '合并双方保留的历史').replace('不会丢失任何一次复习', '每题保留最近 60 次复习');
write('assets/js/sync.js', sync);
let ai = read('server/ai-client.cjs');
// Abort remains armed through response-body reading, not just response headers.
ai = ai.replace('  } finally {\n    clearTimeout(timer);\n  }\n\n  if (!resp.ok)', '  } catch (e) {\n    clearTimeout(timer); throw e;\n  }\n\n  try {\n  if (!resp.ok)');
ai = ai.replace("  const content = data", "  } finally { clearTimeout(timer); }\n  const content = data");
// Declare response data outside the try block.
ai = ai.replace('  let resp;', '  let resp, data;').replace('  const data = await resp.json();', '  data = await resp.json();');
write('server/ai-client.cjs', ai);
write('server.js', String.raw`#!/usr/bin/env node
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { send } = require('./server/http-utils.cjs');
const handleApi = require('./server/api.cjs');
const serveStatic = require('./server/static.cjs');
const createClient = require('./server/ai-client.cjs');
function createApp(options = {}) {
  const root = options.root || __dirname, ai = options.ai || createClient(root);
  const server = http.createServer(async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (e) { send(res, 400, { error: 'bad url' }); return; }
    const origin = req.headers.origin;
    if (pathname.startsWith('/api/') && origin && origin !== 'http://' + req.headers.host) {
      send(res, 403, { error: '跨来源请求被拒绝，请从本服务页面使用 AI' }); return;
    }
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {};
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    try {
      if (await handleApi(req, res, pathname, cors, ai)) return;
      if (pathname.startsWith('/api/')) { send(res, 404, { error: 'unknown api' }, cors); return; }
      serveStatic(req, res, pathname, root);
    } catch (e) { if (!res.headersSent && !res.destroyed) send(res, 500, { ok: false, error: '服务内部错误' }); else res.destroy(); }
  });
  return { server, ai };
}
function start(options = {}) {
  const port = options.port == null ? Number(process.argv[2] || 8000) : options.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 的整数');
  const root = options.root || __dirname, host = options.host || process.env.REVIEW_HOST || '127.0.0.1';
  const portFile = path.join(root, '.server-port'), app = createApp(options);
  let actualPort;
  const ready = new Promise((resolve, reject) => {
    function listen(p, attempt) {
      function failed(e) { if (e.code === 'EADDRINUSE' && attempt < 10 && p < 65535) listen(p + 1, attempt + 1); else reject(e); }
      app.server.once('error', failed);
      app.server.listen(p, host, () => {
        app.server.removeListener('error', failed); actualPort = p;
        try { fs.writeFileSync(portFile, String(p)); } catch (e) {}
        console.log('知识复习工作台：http://localhost:' + p + '/review');
        console.log('AI：' + (app.ai.hasKey ? '已配置' : app.ai.keyError || '未配置，手动复习可用'));
        resolve(p);
      });
    }
    listen(port, 0);
  });
  function cleanup() { try { if (fs.readFileSync(portFile, 'utf8').trim() === String(actualPort)) fs.unlinkSync(portFile); } catch (e) {} }
  app.server.on('close', cleanup);
  return { ...app, ready, cleanup };
}
if (require.main === module) {
  try {
    const app = start();
    app.ready.catch(e => { console.error('启动失败：' + e.message); process.exitCode = 1; });
    process.on('exit', app.cleanup);
    process.on('SIGINT', () => { app.cleanup(); process.exit(); });
    process.on('SIGTERM', () => { app.cleanup(); process.exit(); });
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { createApp, start };
`);
write('启动.cmd', '@echo off\r\nchcp 65001 >nul\r\ntitle Knowledge Review\r\nsetlocal\r\nset "APP_DIR=%~dp0"\r\nset "NODE_EXE=%APP_DIR%runtime\\node.exe"\r\nif not exist "%NODE_EXE%" (\r\n    where node >nul 2>nul\r\n    if errorlevel 1 (\r\n        echo [ERROR] Node.js not found. Please restore runtime\\node.exe.\r\n        pause\r\n        exit /b 1\r\n    )\r\n    set "NODE_EXE=node"\r\n)\r\n"%NODE_EXE%" "%APP_DIR%scripts\\launch.cjs" %1\r\nif errorlevel 1 pause\r\n');
write('启动.sh', '#!/usr/bin/env bash\nset -euo pipefail\nAPP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nif ! command -v node >/dev/null 2>&1; then\n  echo "请安装 Node.js 18+ 后重试。"\n  exit 1\nfi\nnode "$APP_DIR/scripts/launch.cjs" "${1:-8000}"\n');
console.log('Completed module integration.');
