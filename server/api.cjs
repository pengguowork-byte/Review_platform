'use strict';
const { send, readBody } = require('./http-utils.cjs');
const { judgeSystem, buildJudgeUser, quizSystem, kpointsSystem, qbankSystem, buildChunksUser, KP_TYPES, Q_TYPES } = require('./prompts.cjs');
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


module.exports = async function handleApi(req, res, pathname, cors, ai) {
const callDeepSeek = ai.callDeepSeek;
  if (pathname === '/api/health') {
    send(res, 200, { ok: true, hasKey: ai.hasKey, model: ai.model }, cors);
    return true;
  }

  if (pathname === '/api/quiz' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!String(body.reference || '').trim()) {
        send(res, 400, { error: 'reference 为空，无法出题' }, cors);
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }


return false;
};
