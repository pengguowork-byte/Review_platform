#!/usr/bin/env node
/**
 * 嵌入式校招八股 · AI 判分本地代理
 * ---------------------------------------------------------------------------
 * 作用（一个文件同时解决三件事）：
 *   1. 静态托管 d:\study 下的 HTML 笔记（替代 python -m http.server）
 *   2. 代理 /api/quiz  让 DeepSeek 根据标准答案出题（深度自测第一步）
 *   3. 代理 /api/judge 把「考生复述」与「标准答案」交给 DeepSeek 打分
 *
 * 为什么必须走代理：
 *   - DeepSeek 官方 API 不返回 CORS 响应头，浏览器直连会被预检拦截；
 *   - API Key 放在前端等于公开，代理层让 Key 只存在于本进程。
 *
 * 用法：
 *   # PowerShell
 *   $env:DEEPSEEK_API_KEY="sk-你的key"
 *   node server.js            # 默认 8000 端口
 *   node server.js 9000       # 指定端口
 *
 * Key 的读取顺序：环境变量 DEEPSEEK_API_KEY  >  同目录 deepseek.key 文件首行
 * 可选环境变量 DEEPSEEK_BASE_URL 用于切换到任意 OpenAI 兼容端点（联调/测试）。
 *
 * 访问：
 *   http://localhost:8000/嵌入式校招八股_总览.html
 *   http://<本机局域网IP>:8000/...           # 手机连同一 WiFi 时可用
 * ---------------------------------------------------------------------------
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT_ARG = Number(process.argv[2]) || 8000;  // 用户指定的起始端口
let PORT = PORT_ARG;                                // 实际监听端口（占用时自动顺延）
const PORT_FILE = path.join(ROOT, '.server-port');  // 实际端口落盘，供启动脚本打开浏览器
// 默认指向 DeepSeek 官方；可用 DEEPSEEK_BASE_URL 指向任何 OpenAI 兼容端点（联调/测试用）
const UPSTREAM = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const TIMEOUT_MS = 60000;
const MAX_BODY = 2 * 1024 * 1024; // 2MB，分块传输的文本块（知识点/题库生成）需要更大 body

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

/* ---------------- Key 读取 ---------------- */
/** 校验 Key 只含可见 ASCII：中文注释/全角字符一旦混进请求头，
 *  Node fetch 会抛 "Cannot convert argument to a ByteString…" 这种难懂错误，这里提前拦截并说人话 */
function checkKeyAscii(k, from) {
  if (/[^\x21-\x7e]/.test(k)) {
    throw new Error(from + ' 含有非 Key 内容（中文注释/全角字符/不可见字符）。'
      + 'HTTP 请求头只接受英文字符——该行请只保留 API Key 本身');
  }
  return k;
}
/** 环境变量 DEEPSEEK_API_KEY 优先；其次读同目录 deepseek.key 文件。
 *  文件解析容错（v2.0.2）：跳过空行与 # / ; 注释行（用户常直接由 deepseek.key.example 改名而来，
 *  第一行恰好是模板注释，旧逻辑会把注释文字当成 Key 塞进 Authorization 头），行内「Key 备注」只取第一段。 */
function loadKey() {
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim()) {
    return checkKeyAscii(process.env.DEEPSEEK_API_KEY.trim(), '环境变量 DEEPSEEK_API_KEY');
  }
  const p = path.join(ROOT, 'deepseek.key');
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.replace(/^\uFEFF/, '').trim();
      if (!line || /^[#;]/.test(line)) continue;        // 跳过空行 / 注释行
      const key = line.split(/\s+/)[0];                 // 兼容「Key  备注」同行写法
      if (key) return checkKeyAscii(key, 'deepseek.key 文件');
    }
  }
  return '';
}
let API_KEY = '';
let API_KEY_ERR = '';
try {
  API_KEY = loadKey();
} catch (e) {
  // 内容有问题 ≠ 没配 Key：记录下来，启动照常（手动标记等功能仍可用），
  // 但所有 AI 请求会直接返回这条可读的错误，不再抛难懂的 ByteString 天书
  API_KEY_ERR = e.message;
  console.error('[Key 读取失败] ' + e.message);
  console.error('  → 修复：打开 deepseek.key，确保有一行「只有」API Key 本身（该行不要带 # 注释或中文说明）。');
}

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

/** 调用 DeepSeek；返回解析后的 JSON 对象（失败抛错） */
async function callDeepSeek(messages, maxTokens, temperature) {
  if (API_KEY_ERR) throw new Error(API_KEY_ERR);
  if (!API_KEY) throw new Error('服务端未配置 DEEPSEEK_API_KEY');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        temperature: temperature == null ? 0.3 : temperature,
        max_tokens: maxTokens || 900,
        response_format: { type: 'json_object' },
        stream: false
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let msg = 'DeepSeek 返回 ' + resp.status;
    try { const j = JSON.parse(text); msg += '：' + (j.error && j.error.message ? j.error.message : text.slice(0, 200)); }
    catch (e) { msg += ' ' + text.slice(0, 200); }
    throw new Error(msg);
  }

  const data = await resp.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!content) throw new Error('DeepSeek 返回内容为空');

  // json_object 模式下一般已是合法 JSON；遇到 ```json 包裹时剥掉再解析
  let txt = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error('模型返回的不是合法 JSON：' + txt.slice(0, 200));
  }
}

/** 统一的等级归一化：把模型可能给出的别名收敛成内部四个值 */
function normLevel(v, coverage) {
  const s = String(v || '').toLowerCase();
  if (s === 'forgotten') return 'forgotten';
  if (s === 'fuzzy') return 'fuzzy';
  if (s === 'skilled') return 'skilled';
  if (s === 'mastered') return 'mastered';
  // 模型没给或给错时按覆盖率兜底
  if (coverage < 30) return 'forgotten';
  if (coverage < 60) return 'fuzzy';
  if (coverage < 85) return 'skilled';
  return 'mastered';
}

/* ---------------- 判分 Prompt ---------------- */
function judgeSystem() {
  return [
    '你是资深的嵌入式/C++ 技术面试官，负责评判考生对一个知识点的复述质量。评分要严格、可复现，不要客套。',
    '',
    '评分维度（都是 0-100 的整数）：',
    '1. coverage 要点覆盖率：考生复述覆盖了【标准答案要点】中多少比例的关键点。只统计复述里确实出现的内容，答案里有但考生没说的一律算遗漏。',
    '2. accuracy 表述正确率：考生复述中说法正确的比例。出现事实错误、概念张冠李戴、说反了，都要扣准确率。',
    '',
    '【核心结论】权重规则（本题最高优先级）：',
    '- 若输入里给了【核心结论】，它就是本题的一句话结论，是面试时最该先抛出来的内容，权重约等于其余全部要点之和。',
    '- 复述准确表达了核心结论（意思对即可，不要求原句、允许口语化），即视为拿到约一半的 coverage，即使细节有遗漏，coverage 也不得低于 60。',
    '- 核心结论没说，或把核心结论说反了，即使细节背得再多，coverage 也不得高于 55。',
    '- 【详细要点】里若重复了核心结论的内容，不要重复计权。',
    '- 必须在 JSON 里用 "gist":true/false 报告核心结论是否被准确覆盖。',
    '',
    '等级严格按 coverage 映射：',
    '  coverage <  30        -> forgotten（忘记了）',
    '  30 <= coverage < 60   -> fuzzy（模糊）',
    '  60 <= coverage < 85   -> skilled（熟练）',
    '  coverage >= 85        -> mastered（完全掌握）',
    '',
    '附加规则：',
    'A. 若 accuracy < 40（存在明显事实错误），等级最高只能为 fuzzy，不得给 skilled/mastered。',
    'B. 复述为空、跑题、或只抄了题目本身，coverage 记 0，等级 forgotten。',
    'C. 语言口语化、顺序颠倒、用词不同但意思对，算覆盖，不要苛刻。',
    '',
    '只输出 JSON，不要输出任何其他文字，格式：',
    '{"coverage":0,"accuracy":0,"gist":true,"level":"forgotten|fuzzy|skilled|mastered","missed":["遗漏要点","遗漏要点"],"wrong":["错误说法","错误说法"],"comment":"50字以内的针对性点评","next":"30字以内的下一步建议"}',
    'missed / wrong 最多各列 4 条，没有就给空数组。没给【核心结论】时 gist 填 null。'
  ].join('\n');
}

function buildJudgeUser(q) {
  const head = [
    '【题目】' + (q.question || ''),
    ''
  ];
  const gist = String(q.gist || '').trim();
  if (gist) {
    head.push(
      '【核心结论（最高权重：权重≈其余全部要点之和）】' + gist,
      ''
    );
  }
  head.push('【详细要点】' + (q.reference || ''));
  if (q.mode === 'deep') {
    head.push('', '【问答记录】考生回答了下面几道题，请综合评判：');
    (q.qa || []).forEach((item, i) => {
      head.push(
        '第' + (i + 1) + '题 Q：' + (item.q || ''),
        '第' + (i + 1) + '题 评分要点 KEY：' + (item.a || ''),
        '第' + (i + 1) + '题 考生回答 A：' + (item.userAnswer || '（未作答）')
      );
    });
    head.push(
      '',
      '注意：coverage 按各题要点数量加权平均，某题完全没答出则该题要点全部计入 missed；核心结论的权重单独叠加（未覆盖 ≤55，覆盖 ≥60）。'
    );
  } else {
    head.push('', '【考生复述】' + (q.answer || '（未作答）'));
  }
  return head.join('\n');
}

/* ---------------- 出题 Prompt ---------------- */
function quizSystem() {
  return [
    '你是嵌入式/C++ 技术面试官。请根据给定的面试题和标准答案，设计 3 道简答题，用来检验考生是否真正记住了这个知识点。',
    '',
    '出题要求：',
    '1. 不要直接复制标准答案原句，要换成追问、对比、举例、填空的口径。',
    '2. 三道题分别侧重：核心概念 / 易混对比 / 实际场景或细节追问。',
    '3. 每题都能用 1-3 句话答完，只考记忆和理解，不考计算、不考写长代码。',
    '4. 必须覆盖标准答案里最核心、面试最常被追问的点。',
    '5. 每道题附上"该题的评分要点"，写 2-4 条关键词即可，供后续判分使用。',
    '',
    '只输出 JSON，格式：{"questions":[{"q":"问题1","a":"评分要点1；评分要点2"},{"q":"问题2","a":"..."},{"q":"问题3","a":"..."}]}'
  ].join('\n');
}

/* ---------------- 知识点抽取 Prompt ---------------- */
const KP_TYPES = ['定义', '概念', '原理', '公式', '易错点'];

function kpointsSystem() {
  return [
    '你是资深的技术文档分析专家，负责从资料片段中抽取「可独立出题的知识点」。评分风格：宁缺毋滥，只保留确凿内容。',
    '',
    '输出要求（只输出 JSON，格式如下）：',
    '{"points":[{"type":"类型","title":"知识点名","content":"知识点内容","page":0,"confidence":0.9}]}',
    '',
    '字段规则：',
    '1. type 只能是：' + KP_TYPES.join(' / ') + '。定义=给出术语确切含义；概念=解释性说明；原理=机制/流程/原因；公式=含公式或定量关系；易错点=常见误区。',
    '2. title：不超过 20 个字，概括这个知识点本身。',
    '3. content：1-3 句话讲清这个知识点，必须基于原文，不得脑补；专有名词、数字、单位保留原文。',
    '4. page：该知识点来源的页码（输入块里以 [页N] 标注）；不确定填 0。',
    '5. confidence：0-1 小数，对该知识点被完整、准确抽取的把握；原文含糊其辞时低于 0.6。',
    '6. 最多返回 25 个知识点，按重要度降序。重复、过细、无法独立成立的一律剔除。'
  ].join('\n');
}

/* ---------------- 题库生成 Prompt ---------------- */
const Q_TYPES = ['选择题', '填空题', '简答题'];

function qbankSystem() {
  return [
    '你是资深的技术面试出题专家，负责把「知识点」转成面试题库。只依据给定知识点命题，不要引入外部内容。',
    '',
    '输出要求（只输出 JSON，格式如下）：',
    '{"questions":[{"type":"题型","question":"题干","options":["A..","B.."],"answer":"答案","explanation":"解析","page":0,"confidence":0.9}]}',
    '',
    '字段规则：',
    '1. type 只能是：' + Q_TYPES.join(' / ') + '。题干明确属于哪种就填哪种。',
    '2. question：题干完整、无歧义；填空题用 ____ 表示空缺。',
    '3. options：仅选择题需要，给 4 个选项，只有 1 个正确，错误选项要有 plausible 的干扰性；非选择题给空数组。',
    '4. answer：选择题填正确选项的字母，填空题填应填内容，简答题填 2-4 句参考答案。',
    '5. explanation：一句话解析为什么。',
    '6. page：来源页码（知识点里带 [页N] 的沿用）；没有填 0。',
    '7. confidence：0-1 小数，题目表述与答案的可靠程度。',
    '8. 最多返回 20 道题，三种题型搭配出，优先覆盖重要知识点。'
  ].join('\n');
}

/** 把块数组拼成带页码标记的用户输入 */
function buildChunksUser(chunks, points) {
  const lines = [];
  (chunks || []).forEach((c, i) => {
    const p = c.pageFrom && c.pageTo && c.pageFrom !== c.pageTo
      ? '[页' + c.pageFrom + '-' + c.pageTo + ']'
      : '[页' + (c.pageFrom || c.pageTo || 0) + ']';
    lines.push(p + ' ' + String(c.text || '').slice(0, 2000));
  });
  if (points && points.length) {
    lines.push('', '【候选知识点】（优先基于这些出题）');
    points.forEach((pt, i) => lines.push((i + 1) + '. ' + pt.title + '：' + pt.content));
  }
  return lines.join('\n');
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  // 防目录穿越
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const abs = path.join(ROOT, filePath);
  if (!abs.startsWith(ROOT)) { send(res, 403, { error: 'forbidden' }); return; }

  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      // 快捷入口：访问 /review 直接跳到总览页
      if (/^\/review\/?$/i.test(pathname)) {
        res.writeHead(302, { Location: '/' + encodeURIComponent('嵌入式校招八股_总览.html') });
        res.end();
        return;
      }
      send(res, 404, { error: 'not found: ' + pathname });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(abs).pipe(res);
  });
}

/* ---------------- 服务器 ---------------- */
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { send(res, 400, { error: 'bad url' }); return; }
  const pathname = decodeURIComponent(url.pathname);

  // API：统一放开 CORS，方便前端以任意端口访问
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (pathname === '/api/health') {
    send(res, 200, { ok: true, hasKey: !!API_KEY, model: MODEL }, cors);
    return;
  }

  if (pathname === '/api/quiz' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.reference || String(body.reference).length < 20) {
        send(res, 400, { error: 'reference 为空或过短，无法出题' }, cors);
        return;
      }
      const r = await callDeepSeek([
        { role: 'system', content: quizSystem() },
        { role: 'user', content: '【面试题】' + (body.question || '') + '\n\n【标准答案】' + String(body.reference).slice(0, 6000) }
      ], 900, 0.5);
      const questions = Array.isArray(r.questions) ? r.questions.slice(0, 3) : [];
      if (!questions.length) throw new Error('模型未返回题目');
      send(res, 200, { ok: true, questions: questions.map((x) => ({ q: String(x.q || ''), a: String(x.a || '') })) }, cors);
    } catch (e) {
      send(res, 500, { ok: false, error: String(e.message || e) }, cors);
    }
    return;
  }

  if (pathname === '/api/judge' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const mode = body.mode === 'deep' ? 'deep' : 'quick';
      const answered = mode === 'deep'
        ? (body.qa || []).some((x) => x && String(x.userAnswer || '').trim().length > 0)
        : String(body.answer || '').trim().length > 0;

      const raw = await callDeepSeek([
        { role: 'system', content: judgeSystem() },
        { role: 'user', content: buildJudgeUser(body) }
      ], 900, 0.2);

      let coverage = Math.max(0, Math.min(100, parseInt(raw.coverage, 10) || 0));
      let accuracy = Math.max(0, Math.min(100, parseInt(raw.accuracy, 10) || 0));
      // 「一句话结论」高权重兜底：模型不守规则时由服务端强制执行
      // gist=true 核心结论命中 -> 覆盖率不得低于 60（熟练线）
      // gist=false 核心结论缺失/说反 -> 覆盖率不得高于 55（摸不到熟练线）
      if (accuracy >= 40) {
        if (raw.gist === true) coverage = Math.max(coverage, 60);
        if (raw.gist === false) coverage = Math.min(coverage, 55);
      }
      coverage = Math.max(0, Math.min(100, coverage));
      // 等级一律按「最终覆盖率」重算，避免模型自报等级与上面的强制调整冲突
      let level = normLevel(null, coverage);
      // 后端再兜一次「事实错误封顶」，避免模型不守规则
      if (accuracy < 40 && (level === 'skilled' || level === 'mastered')) level = 'fuzzy';
      if (!answered) { coverage = 0; accuracy = 0; level = 'forgotten'; }

      send(res, 200, {
        ok: true,
        mode: mode,
        coverage: coverage,
        accuracy: accuracy,
        gist: raw.gist === true ? true : (raw.gist === false ? false : null),
        level: level,
        missed: Array.isArray(raw.missed) ? raw.missed.slice(0, 4).map(String) : [],
        wrong: Array.isArray(raw.wrong) ? raw.wrong.slice(0, 4).map(String) : [],
        comment: String(raw.comment || ''),
        next: String(raw.next || '')
      }, cors);
    } catch (e) {
      send(res, 500, { ok: false, error: String(e.message || e) }, cors);
    }
    return;
  }

  /* ---- 知识点抽取：从文本块数组中抽取结构化知识点 ---- */
  if (pathname === '/api/kpoints' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const chunks = Array.isArray(body.chunks) ? body.chunks.filter(c => c && String(c.text || '').trim()) : [];
      if (!chunks.length) { send(res, 400, { ok: false, error: 'chunks 为空，没有可抽取的文本' }, cors); return; }
      // 上限保护：单次最多 30 块，防止超大文档把请求体撑爆
      const safe = chunks.slice(0, 30);
      const r = await callDeepSeek([
        { role: 'system', content: kpointsSystem() },
        { role: 'user', content: buildChunksUser(safe, []) }
      ], 1500, 0.3);
      const points = (Array.isArray(r.points) ? r.points : []).slice(0, 25).map((x, i) => ({
        id: 'kp-' + Date.now().toString(36) + '-' + i,
        type: KP_TYPES.indexOf(x && x.type) >= 0 ? x.type : '概念',
        title: String((x && x.title) || '').slice(0, 40) || '未命名知识点',
        content: String((x && x.content) || '').slice(0, 600),
        page: Math.max(0, parseInt(x && x.page, 10) || 0),
        confidence: Math.max(0, Math.min(1, parseFloat(x && x.confidence) || 0.5))
      })).filter(p => p.content);
      if (!points.length) throw new Error('模型未返回有效知识点');
      send(res, 200, { ok: true, points: points, usage: { chunks: safe.length, chars: buildChunksUser(safe, []).length } }, cors);
    } catch (e) {
      send(res, 500, { ok: false, error: String(e.message || e) }, cors);
    }
    return;
  }

  /* ---- 题库生成：从知识点/文本块生成结构化题目 ---- */
  if (pathname === '/api/qbank' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const chunks = Array.isArray(body.chunks) ? body.chunks.filter(c => c && String(c.text || '').trim()) : [];
      const points = Array.isArray(body.points) ? body.points.filter(p => p && String(p.content || '').trim()) : [];
      if (!chunks.length && !points.length) { send(res, 400, { ok: false, error: '既没有知识点也没有文本块，无法出题' }, cors); return; }
      const safeChunks = chunks.slice(0, 20);
      const safePoints = points.slice(0, 20).map(p => ({ title: String(p.title || '').slice(0, 60), content: String(p.content || '').slice(0, 400) }));
      const r = await callDeepSeek([
        { role: 'system', content: qbankSystem() },
        { role: 'user', content: buildChunksUser(safeChunks, safePoints) }
      ], 2000, 0.4);
      const questions = (Array.isArray(r.questions) ? r.questions : []).slice(0, 20).map((x, i) => {
        const type = Q_TYPES.indexOf(x && x.type) >= 0 ? x.type : '简答题';
        const options = Array.isArray(x && x.options) ? x.options.slice(0, 4).map(String) : [];
        return {
          id: 'q-' + Date.now().toString(36) + '-' + i,
          type: type,
          question: String((x && x.question) || '').slice(0, 500),
          options: type === '选择题' ? options : [],
          answer: String((x && x.answer) || '').slice(0, 800),
          explanation: String((x && x.explanation) || '').slice(0, 400),
          page: Math.max(0, parseInt(x && x.page, 10) || 0),
          confidence: Math.max(0, Math.min(1, parseFloat(x && x.confidence) || 0.5))
        };
      }).filter(q => q.question && q.answer);
      if (!questions.length) throw new Error('模型未返回有效题目');
      send(res, 200, { ok: true, questions: questions }, cors);
    } catch (e) {
      send(res, 500, { ok: false, error: String(e.message || e) }, cors);
    }
    return;
  }

  if (pathname.indexOf('/api/') === 0) { send(res, 404, { error: 'unknown api' }, cors); return; }

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  serveStatic(req, res, pathname);
});

/** 端口被占用时自动顺延：从 PORT_ARG 起最多尝试 10 个端口 */
function tryListen(p, attempt) {
  server.removeAllListeners('error');
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < 10) {
      console.warn('端口 ' + p + ' 被占用，自动尝试 ' + (p + 1) + ' …');
      setTimeout(() => tryListen(p + 1, attempt + 1), 30);
      return;
    }
    if (e.code === 'EADDRINUSE') {
      console.error('端口 ' + PORT_ARG + ' ~ ' + (PORT_ARG + 10) + ' 全部被占用，请手动换端口：node server.js <端口>');
    } else {
      console.error(e);
    }
    process.exit(1);
  });
  server.listen(p, () => onListen(p));
}

tryListen(PORT, 0);

function onListen(p) {
  PORT = p;
  banner(p);
  // 把实际端口写给启动脚本，保证浏览器打开的是真正在听的端口
  try { fs.writeFileSync(PORT_FILE, String(p)); } catch (e) { /* 只读目录时静默失败 */ }
}

function banner(p) {
  console.log('==============================================');
  console.log('  嵌入式校招八股 · AI 判分服务已启动');
  console.log('==============================================');
  console.log('  本页入口   http://localhost:' + p + '/嵌入式校招八股_总览.html');
  console.log('  快捷入口   http://localhost:' + p + '/review');
  console.log('  局域网     http://<你的IP>:' + p + '/   （手机连同一 WiFi 时可用）');
  console.log('  API Key    ' + (API_KEY ? '已就绪（' + API_KEY.slice(0, 6) + '****）' : API_KEY_ERR ? '读取失败（见下）' : '未配置！'));
  if (API_KEY_ERR) {
    console.log('  ↓ ' + API_KEY_ERR);
    console.log('    打开 deepseek.key，确保有一行「只有」API Key 本身，不要带 # 注释或中文说明。');
  } else if (!API_KEY) {
    console.log('  ↓ 请设置环境变量后重启：');
    console.log('    $env:DEEPSEEK_API_KEY="sk-你的key"; node server.js');
    console.log('  或在脚本同目录新建 deepseek.key 文件，首行写入 Key。');
  }
  console.log('==============================================');
}

// 进程退出时清理端口文件，避免留下陈旧文件误导启动脚本
function cleanupPortFile() {
  try { if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE); } catch (e) {}
}
process.on('exit', cleanupPortFile);
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
