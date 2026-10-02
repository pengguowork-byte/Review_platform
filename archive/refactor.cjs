// One-time migration of the original single-page release. Run only against v2.0.2.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); };
let page = read('嵌入式校招八股_总览.html');
if (page.includes('assets/js/bootstrap.js')) throw new Error('Already migrated');
write('archive/总览-v2.0.2.html', page);
const topicMeta = [
  ['cpp', 'C++', 'programming'], ['os', '操作系统', 'fundamentals'],
  ['net', '计算机网络', 'fundamentals'], ['rtos', 'FreeRTOS', 'embedded'],
  ['stm32', 'STM32', 'embedded'], ['ros', 'ROS', 'robotics']
];
const start = page.indexOf('<div class="chapter-title" id="cpp">');
const end = page.indexOf('  </main>', start);
const body = page.slice(start, end);
const chapters = [...body.matchAll(/<div class="chapter-title" id="([^"]+)">/g)];
const navStart = page.indexOf('<a class="chap" href="#cpp">');
const navEnd = page.indexOf('  </aside>', navStart);
const navigation = page.slice(navStart, navEnd);
const navChapters = [...navigation.matchAll(/<a class="chap" href="#([^"]+)">/g)];
const bank = {
  version: 1,
  categories: [
    { id: 'programming', name: '编程语言' }, { id: 'fundamentals', name: '计算机基础' },
    { id: 'embedded', name: '嵌入式与硬件' }, { id: 'robotics', name: '机器人' },
    { id: 'languages', name: '语言学习' }, { id: 'science', name: '数学与科学' },
    { id: 'humanities', name: '人文与社会' }
  ],
  subjects: topicMeta.map(([id, name, categoryId], i) => ({
    id, name, categoryId,
    contentHtml: body.slice(chapters[i].index, i + 1 < chapters.length ? chapters[i + 1].index : body.length),
    navigationHtml: navigation.slice(navChapters[i].index, i + 1 < navChapters.length ? navChapters[i + 1].index : navigation.length)
  }))
};
write('data/library.json', JSON.stringify(bank, null, 2));
page = page.slice(0, start) + '<!-- Subject content is rendered from data/library.json. -->\n' + page.slice(end);
page = page.replace(navigation, '<!-- Subject navigation is rendered by library.js. -->\n');
page = page.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => {
  write('assets/css/app.css', css.trim() + '\n');
  return '<link rel="stylesheet" href="assets/css/app.css">\n<link rel="stylesheet" href="assets/css/library.css">';
});
// Strip HTML comments while finding scripts so a literal <script> in a comment is not mistaken for a tag.
const commentless = page.replace(/<!--[\s\S]*?-->/g, '');
const scripts = [...commentless.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 5) throw new Error('Unexpected script count');
write('assets/js/diagrams.js', 'if (window.mermaid) {\n' + scripts[0] + '\n}\n');
write('assets/js/search.js', scripts[1]);
write('assets/js/navigation.js', scripts[2]);
let review = scripts[3];
const syncStart = review.indexOf('  /* ==================== 数据同步');
write('assets/js/sync.js', 'window.KnowledgeSync = function (ctx) {\n' +
  '  var db = ctx.db, LEVELS = ctx.LEVELS, esc = ctx.esc, titleOf = ctx.titleOf;\n' +
  '  var applyVerdict = ctx.applyVerdict, saveDB = ctx.saveDB, updateLvlBtn = ctx.updateLvlBtn, renderStats = ctx.renderStats;\n' +
  '  var applyReviewMode = ctx.applyReviewMode;\n' + review.slice(syncStart, review.lastIndexOf('})();')) + '\n};\n');
review = review.slice(0, syncStart) +
  '  window.KnowledgeSync({ db: db, LEVELS: LEVELS, esc: esc, titleOf: titleOf, applyVerdict: applyVerdict, saveDB: saveDB, updateLvlBtn: updateLvlBtn, renderStats: renderStats, applyReviewMode: applyReviewMode });\n})();\n';
write('assets/js/review-ui.js', review);
write('assets/js/extraction.js', scripts[4]);
page = page.replace(/<!--[\s\S]*?-->/g, '');
page = page.replace(/<script>[\s\S]*?<\/script>/g, '');
page = page.replace(/<script src="https:\/\/cdn.jsdelivr.net\/npm\/mermaid@10\/dist\/mermaid.min.js"><\/script>/, '');
page = page.replace(/嵌入式校招八股 · (单页总览|总览)/g, '知识复习工作台');
page = page.replace(/6 大模块 · 共 296 题 · 分层式/, '多领域知识 · 分类学习');
page = page.replace(/<p>六大模块：[\s\S]*?<\/p>/, '<p id="librarySummary"></p>');
page = page.replace('<div class="toolbar">', '<div id="categoryTabs" class="category-tabs" aria-label="知识类型"></div>\n      <div class="library-tools"><label>知识专题 <select id="subjectSelect"><option value="">全部专题</option></select></label><button class="btn" id="libraryImportBtn">导入题库</button><input id="libraryFile" type="file" accept=".json,application/json" hidden><span id="libraryStatus" role="status"></span></div>\n      <div class="toolbar">');
page = page.replace(/placeholder="搜索题目 \/ 关键词，如：[^"]*"/, 'placeholder="搜索当前知识类型中的题目 / 关键词…"');
page = page.replace('node server.js</code>', '启动.cmd</code>');
page = page.replace('</body>', [
  '<script src="assets/data/library.js"></script>',
  ...['review-engine', 'library', 'search', 'navigation', 'sync', 'review-ui', 'extraction', 'diagrams', 'bootstrap'].map(n => '<script src="assets/js/' + n + '.js"></script>'),
  '</body>'
].join('\n'));
write('index.html', page);

// Backend modules retain the current API contract.
const server = read('server.js');
write('archive/server-v2.0.2.js', server);
const promptsStart = server.indexOf('/* ---------------- 判分 Prompt');
const staticStart = server.indexOf('/* ---------------- 静态文件');
let prompts = server.slice(promptsStart, staticStart).replace(/资深的嵌入式\/C\+\+ 技术面试官/g, '资深的跨学科学习评估专家').replace(/嵌入式\/C\+\+ 技术面试官/g, '跨学科学习评估专家').replace(/资深的技术面试出题专家/g, '资深的知识测验出题专家');
write('server/prompts.cjs', "'use strict';\n" + prompts + '\nmodule.exports = { judgeSystem, buildJudgeUser, quizSystem, kpointsSystem, qbankSystem, buildChunksUser, KP_TYPES, Q_TYPES };\n');
const keyStart = server.indexOf('/* ---------------- Key 读取');
const utilsStart = server.indexOf('/* ---------------- 工具');
const apiStart = server.indexOf('async function callDeepSeek');
const normStart = server.indexOf('/** 统一的等级归一化');
const keyFunctions = server.slice(keyStart, server.indexOf("let API_KEY = ''", keyStart));
write('server/ai-client.cjs', "'use strict';\nconst fs = require('fs');\nconst path = require('path');\nmodule.exports = function createClient(ROOT) {\n" +
  "const UPSTREAM = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';\nconst MODEL = process.env.AI_MODEL || 'deepseek-chat';\nconst TIMEOUT_MS = 60000;\n" + keyFunctions +
  server.slice(server.indexOf("let API_KEY = ''", keyStart), utilsStart) +
  server.slice(apiStart, normStart) + '\nreturn { callDeepSeek, hasKey: !!API_KEY, keyError: API_KEY_ERR, model: MODEL };\n};\n');
const utils = server.slice(utilsStart, server.indexOf('/** 调用 DeepSeek', utilsStart));
write('server/http-utils.cjs', "'use strict';\nconst MAX_BODY = 2 * 1024 * 1024;\n" + utils + '\nmodule.exports = { send, readBody };\n');
let api = server.slice(server.indexOf("  if (pathname === '/api/health')"), server.indexOf('  if (pathname.indexOf', staticStart));
api = api.replace('hasKey: !!API_KEY, model: MODEL', 'hasKey: ai.hasKey, model: ai.model');
api = api.replace(/\n    return;/g, '\n    return true;');
const norm = server.slice(normStart, promptsStart);
write('server/api.cjs', "'use strict';\nconst { send, readBody } = require('./http-utils.cjs');\nconst { judgeSystem, buildJudgeUser, quizSystem, kpointsSystem, qbankSystem, buildChunksUser, KP_TYPES, Q_TYPES } = require('./prompts.cjs');\n" + norm +
  '\nmodule.exports = async function handleApi(req, res, pathname, cors, ai) {\nconst callDeepSeek = ai.callDeepSeek;\n' + api + '\nreturn false;\n};\n');
console.log('Extracted styles, six subjects, five frontend modules and backend modules.');
