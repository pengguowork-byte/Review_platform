'use strict';
const { spawn } = require('child_process');
const { start } = require('../server.js');
const app = start();
app.ready.then(port => {
  const url = 'http://localhost:' + port + '/review';
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const browser = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  browser.on('error', () => console.log('请手动打开：' + url)); browser.unref();
}).catch(e => { console.error('启动失败：' + e.message); process.exitCode = 1; });
process.on('exit', app.cleanup);
process.on('SIGINT', () => { app.cleanup(); process.exit(); });
process.on('SIGTERM', () => { app.cleanup(); process.exit(); });
