'use strict';
const fs = require('fs');
const path = require('path');
const { send } = require('./http-utils.cjs');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
module.exports = function serveStatic(req, res, pathname, root) {
  if (!['GET', 'HEAD'].includes(req.method)) { send(res, 405, { error: 'method not allowed' }); return; }
  if (/^\/review\/?$/i.test(pathname)) {
    res.writeHead(302, { Location: '/' + encodeURIComponent('嵌入式校招八股_总览.html') }); res.end(); return;
  }
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  const allowed = ['index.html', 'sw.js', 'manifest.webmanifest'].includes(name) || (name.startsWith('assets/') && ['.js', '.css', '.png', '.jpg', '.svg', '.ico'].includes(path.extname(name))) || (name.startsWith('data/') && path.extname(name) === '.json') || (!name.includes('/') && !name.includes('\\') && name.endsWith('.html'));
  const abs = path.resolve(root, name);
  const relative = path.relative(root, abs);
  if (!allowed || relative.startsWith('..') || path.isAbsolute(relative) || name.includes('\\') || name.split('/').some(part => part.startsWith('.'))) {
    send(res, 403, { error: 'forbidden' }); return;
  }
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) { send(res, 404, { error: 'not found' }); return; }
    res.writeHead(200, { 'Content-Type': name === 'manifest.webmanifest' ? 'application/manifest+json' : MIME[path.extname(abs)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
  });
};
