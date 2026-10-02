'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const engine = require('../assets/js/review-engine.js');
const preferences = require('../assets/js/library-preferences.js');
const { createApp } = require('../server.js');
const root = path.resolve(__dirname, '..');
test('recent modules are unique and contain only the five most recently used', () => {
  const state = preferences.normalize({});
  ['programming','fundamentals','embedded','robotics','languages','science'].forEach(id=>preferences.touch(state,id));
  assert.deepEqual(state.recent, ['science','languages','robotics','embedded','fundamentals']);
  preferences.touch(state,'embedded');
  assert.deepEqual(state.recent, ['embedded','science','languages','robotics','fundamentals']);
  assert.deepEqual(preferences.normalize(JSON.parse(JSON.stringify(state))).recent,state.recent);
});
test('module preferences accept custom names and tolerate broken data', () => {
  assert.equal(preferences.name('  我的算法复习  '),'我的算法复习');
  assert.throws(()=>preferences.name('   '));
  assert.throws(()=>preferences.name('A'.repeat(61)));
  const state = preferences.normalize({recent:['programming','programming',null,'../../key'],categories:[{id:'module-test',name:'自定义模块'},null]});
  assert.deepEqual(state.recent,['programming']);
  assert.deepEqual(state.categories,[{id:'module-test',name:'自定义模块'}]);
});
function parsers() {
  const scope = { window: {}, console };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/extract-parsers.js'), 'utf8'), scope);
  return scope.window.extractParsers({ st: { lib: {} }, CDN: {}, ACCEPT: { pdf:'pdf', docx:'docx', png:'img' }, MAX_SIZE:50*1024*1024, CHUNK_SIZE:2000, fmtSize:n=>String(n), log:()=>{} });
}
test('parser validation handles size limits and PDF magic', async () => {
  const p = parsers();
  const large = await p.validateFile({ name:'sample.pdf', size:51*1024*1024 });
  assert.equal(large.ok, false); assert.match(large.err, /50MB/);
  const file = { name:'sample.pdf', size:10, slice:()=>({arrayBuffer:async()=>new Uint8Array([37,80,68,70,45,49,46,55]).buffer}) };
  assert.equal((await p.validateFile(file)).ok, true);
});
test('parser chunks preserve all characters and page metadata', () => {
  const chunks = parsers().buildChunks([{pageFrom:3,pageTo:3,text:'A'.repeat(4500),isOcr:false}], 'file-1');
  assert.equal(chunks.map(c=>c.text).join('').length, 4500);
  assert.ok(chunks.every(c=>c.text.length<=2000 && c.pageFrom===3 && c.fileId==='file-1'));
});
test('all modules parse and all shell assets exist', () => {
  for (const dir of ['assets/js', 'server', 'scripts']) {
    for (const name of fs.readdirSync(path.join(root, dir)).filter(n => /\.(js|cjs)$/.test(n))) new vm.Script(fs.readFileSync(path.join(root, dir, name), 'utf8'), { filename: dir + '/' + name });
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(assets\/[^\"]+)"/g)) assert.ok(fs.existsSync(path.join(root, match[1])), match[1]);
  assert.equal(html, fs.readFileSync(path.join(root, '嵌入式校招八股_总览.html'), 'utf8'));
});
test('built-in card IDs and content are preserved', () => {
  const original = fs.readFileSync(path.join(root, 'archive/总览-v2.0.2.html'), 'utf8');
  const bank = JSON.parse(fs.readFileSync(path.join(root, 'data/library.json'), 'utf8'));
  const content = bank.subjects.map(s => s.contentHtml || JSON.parse(fs.readFileSync(path.join(root, s.source), 'utf8')).contentHtml).join('');
  const ids = text => [...text.matchAll(/class="q" id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids(content), ids(original)); assert.equal(ids(content).length, 296);
  const from = original.indexOf('<div class="chapter-title" id="cpp">');
  assert.equal(content, original.slice(from, original.indexOf('  </main>', from)));
});
test('proficiency must be consecutive', () => {
  const c = engine.createCard();
  engine.apply(c, 'skilled', 70, 90, false, 100);
  engine.apply(c, 'fuzzy', 40, 90, false, 200);
  engine.apply(c, 'skilled', 70, 90, false, 300);
  assert.equal(c.gate, 1);
  engine.apply(c, 'skilled', 75, 90, false, 400); assert.equal(c.gate, 2); assert.equal(c.interval, 7);
});
test('fuzzy intervals are bounded at seven days', () => {
  const c = engine.createCard();
  const intervals = [100, 200, 300, 400].map(t => { engine.apply(c, 'fuzzy', 40, 90, false, t); return c.interval; });
  assert.deepEqual(intervals, [1, 3, 7, 7]);
});
test('forgotten forces restudy and resets graduation', () => {
  const c = engine.createCard(); engine.apply(c, 'mastered', 90, 90, false, 100); engine.apply(c, 'forgotten', 0, 0, false, 200);
  assert.equal(c.gate, 0); assert.equal(c.due, 200); assert.equal(c.restudy, true);
});
test('merge is chronological, commutative and idempotent', () => {
  const old = engine.createCard(), recent = engine.createCard();
  engine.apply(old, 'forgotten', 0, 0, false, 100);
  engine.apply(recent, 'mastered', 90, 90, false, 200);
  const merged = engine.merge(recent, old);
  assert.equal(merged.level, 'mastered'); assert.equal(merged.due, 200);
  assert.deepEqual(merged, engine.merge(old, recent));
  assert.deepEqual(merged, engine.merge(merged, old));
});
test('merge preserves event times rather than scheduling from import time', () => {
  const a = engine.createCard(), b = engine.createCard();
  engine.apply(a, 'skilled', 70, 90, false, 100); engine.apply(b, 'skilled', 70, 90, false, 200);
  assert.equal(engine.merge(a, b).due, 200 + 7 * 86400000);
});
test('manual reset survives merging and does not leak an old score', () => {
  const a = engine.createCard(), b = engine.createCard();
  engine.apply(a, 'mastered', 90, 90, false, 100); engine.apply(b, null, null, null, true, 200);
  assert.equal(engine.merge(a, b).level, null);
  assert.equal(engine.merge(a, b).lastScore, undefined);
});
test('retained history is limited and checkpoint makes repeat merge stable', () => {
  const a = engine.createCard(); for (let i = 1; i <= 75; i++) engine.apply(a, 'skilled', 70, 90, false, i);
  assert.equal(a.history.length, 60); assert.ok(a.checkpoint);
  assert.deepEqual(engine.merge(a, a), a);
});
test('HTTP routes protect private files, malformed URLs and cross-origin AI', async () => {
  const { server } = createApp({ ai: { hasKey: false, model: 'mock', callDeepSeek: async () => ({}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(url + '/')).status, 200);
    assert.equal((await fetch(url + '/review', { redirect: 'manual' })).status, 302);
    for (const name of ['/deepseek.key', '/server.js', '/runtime/node.exe', '/archive/总览-v2.0.2.html', '/.server-port']) assert.equal((await fetch(url + name)).status, 403, name);
    assert.equal((await fetch(url + '/%E0%A4%A')).status, 400);
    assert.equal((await fetch(url + '/api/health')).status, 200);
    assert.equal((await fetch(url + '/api/judge', { method: 'POST', headers: { Origin: 'https://example.org' }, body: '{}' })).status, 403);
    assert.equal((await fetch(url + '/assets/js/library.js')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('AI verdict uses server thresholds and accuracy cap', async () => {
  let value = { coverage: 99, accuracy: 20, level: 'mastered' };
  const { server } = createApp({ ai: { hasKey: true, model: 'mock', callDeepSeek: async () => value } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/judge';
    const judge = async () => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: '测试复述' }) })).json();
    assert.equal((await judge()).level, 'fuzzy');
    value = { coverage: 29, accuracy: 90 }; assert.equal((await judge()).level, 'forgotten');
    value = { coverage: 60, accuracy: 90 }; assert.equal((await judge()).level, 'skilled');
    value = { coverage: 85, accuracy: 90 }; assert.equal((await judge()).level, 'mastered');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
