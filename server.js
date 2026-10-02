#!/usr/bin/env node
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
