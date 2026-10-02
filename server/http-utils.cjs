'use strict';
const MAX_BODY = 2 * 1024 * 1024;
/* ---------------- 工具 ---------------- */
function send(res, code, obj, headers) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')));
    req.on('error', reject);
  });
}


module.exports = { send, readBody };
