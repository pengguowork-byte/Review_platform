
(function () {
  var KEY = 'eb-review-system-v1';
  var DAY = 86400000;
  /* ============ 五个记忆等级 ============
   * 前四级由 DeepSeek 按「要点覆盖率」判定（未记忆 = 从未自测）。
   *   coverage <  30  -> forgotten 忘记了
   *   30 <= c < 60    -> fuzzy     模糊
   *   60 <= c < 85    -> skilled   熟练
   *   c >= 85         -> mastered  完全掌握
   * 附加：准确率 < 40%（有明显事实错误）时，等级最高只能判「模糊」。
   */
  var LEVELS = {
    unseen:    { label: '未记忆',   short: '未', cls: 'lv-unseen',    color: '#64748b', desc: '尚未开始自测',        cov: '—' },
    forgotten: { label: '忘记了',   short: '忘', cls: 'lv-forgotten', color: '#dc2626', desc: '覆盖率 < 30%，基本想不起', cov: '<30' },
    fuzzy:     { label: '模糊',     short: '糊', cls: 'lv-fuzzy',     color: '#d97706', desc: '覆盖率 30~60%，零散记得', cov: '30–60' },
    skilled:   { label: '熟练',     short: '熟', cls: 'lv-skilled',   color: '#059669', desc: '覆盖率 60~85%，大体能讲', cov: '60–85' },
    mastered:  { label: '完全掌握', short: '精', cls: 'lv-mastered',  color: '#2563eb', desc: '覆盖率 ≥ 85%，完整复述',   cov: '≥85' }
  };
  var ORDER = ['unseen', 'forgotten', 'fuzzy', 'skilled', 'mastered'];

  function loadDB() { try { return JSON.parse(localStorage.getItem(KEY)) || { cards: {} }; } catch (e) { return { cards: {} }; } }
  function saveDB() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  var db = loadDB();
  if (!db.cards) db.cards = {};
  var reviewMode = false;

  /* —— 旧版数据迁移：四等级 → 五等级，「记错了」并入「忘记了」 —— */
  (function migrate() {
    Object.keys(db.cards).forEach(function (cid) {
      var c = db.cards[cid];
      if (c.level === 'wrong') c.level = 'forgotten';
      if (Array.isArray(c.history)) c.history.forEach(function (h) { if (h.level === 'wrong') h.level = 'forgotten'; });
      if (c.gate == null) c.gate = (c.level === 'skilled') ? 1 : 0;
      if (c.stage == null) c.stage = 0;
      if (c.lapses == null) c.lapses = 0;
      if (c.quizzes == null) c.quizzes = 0;
    });
  })();

  function read(cid) { return db.cards[cid] || null; }
  function get(cid) {
    if (!db.cards[cid]) db.cards[cid] = window.ReviewEngine.createCard();
    return db.cards[cid];
  }
  function norm(v) { return LEVELS[v] ? v : 'unseen'; }
  /** 是否仍在学习队列（未毕业）：连续 2 次达标前都算没还完的债 */
  function inQueue(c) { return !!c && !!c.level && c.level !== 'unseen' && (c.gate || 0) < 2; }
  /** 是否已到期 */
  function isDue(c) { return !!c && !!c.level && c.level !== 'unseen' && !!c.due && c.due <= Date.now(); }

  /* ============ 间隔重复 + 毕业门控算法 ============
   * 1. 连续 2 次自测达到「熟练」及以上才毕业（离开待复习队列）。
   * 2. 「忘记了」触发强制重学：当天立即重新到期 + 必须回顾答案后复测。
   * 3. 「模糊」按 1 → 3 → 7 天递增；未达标不清零，需连续两次达标才毕业。
   * 4. 毕业后进入长期间隔复查，到期则 gate 归零重新证明一次。
   */
  var SKILLED_TRACK = [7, 15, 30, 60];
  var MASTERED_TRACK = [30, 60, 120];

  function applyVerdict(c, level, cov, acc, manual) {
    window.ReviewEngine.apply(c, level, cov, acc, manual);
    saveDB();
  }

  /** 到期复查的毕业题重新入队 */
  function refreshLapsed() {
    var changed = false;
    Object.keys(db.cards).forEach(function (cid) {
      var c = db.cards[cid];
      if (c.level && c.level !== 'unseen' && (c.gate || 0) >= 2 && c.due && c.due <= Date.now()) {
        c.gate = 0; changed = true;
      }
    });
    if (changed) saveDB();
  }

  function setLevel(cid, level) {
    applyVerdict(get(cid), level || null, null, null, true);
    updateLvlBtn(cid); renderStats(); refreshPanel(cid); applyReviewMode();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function closePops() { document.querySelectorAll('.lv-pop.open').forEach(function (p) { p.classList.remove('open'); }); }

  // —— 为每张卡片注入等级按钮 ——
  function injectLvlButtons() {
    document.querySelectorAll('main .q').forEach(function (q) {
      var cid = q.id;
      var head = q.querySelector('.q-head');
      if (!head) return;
      if (!head.querySelector('.q-lvl')) {
        var box = document.createElement('div');
        box.className = 'q-lvl';
        box.setAttribute('data-cid', cid);
        box.innerHTML = '<button class="lv lv-main" type="button"></button><div class="lv-pop"></div>';
        head.appendChild(box);
        box.addEventListener('click', function (e) {
          e.stopPropagation();
          var opt = e.target.closest('.lv-pop .lv');
          if (opt) { var lv = opt.getAttribute('data-level'); setLevel(cid, lv === 'unseen' ? null : lv); closePops(); return; }
          var main = e.target.closest('.lv-main');
          if (main) { var pop = box.querySelector('.lv-pop'); var willOpen = !pop.classList.contains('open'); closePops(); if (willOpen) pop.classList.add('open'); }
        });
      }
      // AI 自测入口（不开判分服务时按钮禁用态）
      if (!head.querySelector('.quiz-btn')) {
        var w = document.createElement('span');
        w.className = 'quiz-wrap';
        w.style.cssText = 'display:inline-flex;gap:6px;flex:none;margin-left:6px;';
        w.innerHTML =
          '<button class="quiz-btn" type="button" data-mode="quick" title="凭记忆复述，由 DeepSeek 比对标准答案判分">AI 自测</button>' +
          '<button class="quiz-btn deep" type="button" data-mode="deep" title="由 DeepSeek 先出 3 道简答题，答完统一判分">深测</button>';
        head.appendChild(w);
      }
      if (!q.querySelector('.quiz-panel')) {
        var panel = document.createElement('div');
        panel.className = 'quiz-panel';
        panel.setAttribute('data-cid', cid);
        q.insertBefore(panel, q.querySelector('.q-head').nextSibling);
      }
    });
  }
  function buildPops() {
    var html = '';
    ORDER.forEach(function (k) {
      var L = LEVELS[k];
      html += '<button class="lv ' + L.cls + '" type="button" data-level="' + k + '"><span class="lv-dot"></span>' + L.label + '<span class="lv-desc">' + L.desc + '</span></button>';
    });
    document.querySelectorAll('.q-lvl .lv-pop').forEach(function (p) { p.innerHTML = html; });
  }
  function updateLvlBtn(cid) {
    var c = read(cid);
    var L = LEVELS[(c && c.level) || 'unseen'];
    document.querySelectorAll('.q-lvl[data-cid="' + cid + '"]').forEach(function (box) {
      var btn = box.querySelector('.lv-main');
      if (btn) { btn.className = 'lv lv-main ' + L.cls; btn.innerHTML = '<span class="lv-dot"></span>' + L.short; btn.title = L.label + ' · ' + L.desc; }
    });
  }

  // —— 统计 ——
  function renderStats() {
    var total = Array.from(document.querySelectorAll('main .q')).filter(window.KnowledgeLibrary.matches).length;
    var cnt = { unseen: 0, forgotten: 0, fuzzy: 0, skilled: 0, mastered: 0 };
    var queue = 0, dueCount = 0, quizzes = 0, scoreSum = 0, scoreN = 0, passes = 0;
    var now = Date.now();
    for (var cid in db.cards) {
      if (!document.getElementById(cid) || !window.KnowledgeLibrary.matches(document.getElementById(cid))) continue;
      var c = db.cards[cid];
      if (!c.level || c.level === 'unseen') continue;
      cnt[norm(c.level)]++;
      if (inQueue(c)) { queue++; if (isDue(c)) dueCount++; }
      quizzes += c.quizzes || 0;
      if (typeof c.lastScore === 'number') { scoreSum += c.lastScore; scoreN++; }
      passes += c.lapses || 0;
    }
    var unseen = total - cnt.forgotten - cnt.fuzzy - cnt.skilled - cnt.mastered;
    ORDER.forEach(function (k) {
      var el = document.getElementById('st-' + k);
      if (el) el.textContent = (k === 'unseen' ? unseen : cnt[k]);
    });
    document.getElementById('rbDue').textContent = '待复习 ' + dueCount + ' 题 · 未毕业 ' + queue + ' 题';
    document.getElementById('basketBtn').textContent = '另一个篮子 (' + queue + ')';
    var pct = total ? Math.round((cnt.skilled + cnt.mastered) / total * 100) : 0;
    var bar = document.getElementById('rbBar');
    bar.style.width = pct + '%';
    bar.title = '当前范围熟练或完全掌握占比 ' + pct + '%';
    var meta = document.getElementById('quizMeta');
    if (meta) {
      meta.innerHTML = serverOk
        ? 'AI 自测 ' + quizzes + ' 次 · 平均覆盖 ' + (scoreN ? Math.round(scoreSum / scoreN) : 0) + '%' + (passes ? ' · 翻车 ' + passes + ' 次' : '')
        : '<span style="color:#fca5a5">判分服务未连接：请运行 node server.js</span>';
    }
  }

  window.KnowledgeReview = {
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
  // —— 全局复习模式 ——
  function applyReviewMode() {
    document.body.classList.toggle('review-mode', reviewMode);
    if (window.KnowledgeView) window.KnowledgeView.refresh();
  }
  function toggleReviewMode() { reviewMode = !reviewMode; applyReviewMode(); }

  // —— 另一个篮子：存放所有「未毕业」的题（连续 2 次达标前） —
  function collectBasket() {
    var items = [];
    for (var cid in db.cards) { var c = db.cards[cid]; var card = document.getElementById(cid); if (card && window.KnowledgeLibrary.matches(card) && inQueue(c)) items.push({ cid: cid, c: c }); }
    items.sort(function (a, b) { return (a.c.due || 0) - (b.c.due || 0); });
    return items;
  }
  function fmtDue(ts) {
    if (!ts) return '未排期';
    var d = Math.round((ts - Date.now()) / DAY);
    if (d <= 0) return '待复习';
    if (d === 1) return '明天';
    return d + ' 天后';
  }
  function renderBasket() {
    var list = document.getElementById('basketList');
    if (!list) return;
    var items = collectBasket();
    var now = Date.now();
    var dueCount = items.filter(function (i) { return isDue(i.c); }).length;
    document.getElementById('basketHint').textContent = '未连续 2 次达标（未毕业）的题都会进这里，按到期时间排序。今日到期待复习 ' + dueCount + ' 题。';
    if (items.length === 0) {
      list.innerHTML = '<div class="basket-empty">篮子为空<br>用卡片上的「AI 自测」判分后，未毕业的题会自动出现在这里</div>';
      return;
    }
    var html = '';
    items.forEach(function (it) {
      var c = it.c;
      var L = LEVELS[norm(c.level)];
      var card = document.getElementById(it.cid);
      var title = card ? card.querySelector('.q-title').textContent : it.cid;
      var gist = (card && card.querySelector('.gist')) ? card.querySelector('.gist').textContent : '';
      var dueTxt = fmtDue(c.due);
      var overdue = isDue(c);
      var gate = c.gate || 0;
      html += '<div class="basket-item" data-cid="' + esc(it.cid) + '">'
        + '<div class="bi-hd" role="button" tabindex="0">'
        + '<span class="bi-tag ' + L.cls + '">' + L.label + '</span>'
        + '<span class="bi-title">' + esc(title) + '</span>'
        + '<span class="bi-due"' + (overdue ? ' style="color:#ef4444;font-weight:700"' : '') + '>' + esc(dueTxt) + '</span>'
        + '</div>'
        + '<div class="bi-body">'
        + (gist ? '<div class="bi-gist">一句话：' + esc(gist) + '</div>' : '')
        + '<div style="font-size:11px;color:var(--muted);margin:4px 0 2px;">毕业进度 ' + Math.min(gate, 2) + '/2 · 已自测 ' + (c.quizzes || 0) + ' 次' + (c.restudy ? ' · <span style="color:#dc2626;font-weight:700">需强制重学</span>' : '') + '</div>'
        + '<div class="fb">'
        + '<button class="fb-wrong" type="button" data-r="forgotten">忘记了</button>'
        + '<button class="fb-fuzzy" type="button" data-r="fuzzy">模糊</button>'
        + '<button class="fb-skilled" type="button" data-r="skilled">记住了</button>'
        + '</div>'
        + '<div style="font-size:10.5px;color:var(--muted);margin-top:6px;">无 AI 判分服务时，可点这里手动标记</div>'
        + '</div></div>';
    });
    list.innerHTML = html;
  }

  document.getElementById('basketList').addEventListener('click', function (e) {
    var fb = e.target.closest('.fb button[data-r]');
    if (fb) {
      var cid = fb.closest('.basket-item').getAttribute('data-cid');
      applyVerdict(get(cid), fb.getAttribute('data-r'), null, null, true);
      updateLvlBtn(cid); renderStats(); renderBasket(); refreshPanel(cid); applyReviewMode();
      return;
    }
    var hd = e.target.closest('.bi-hd');
    if (hd) hd.parentElement.classList.toggle('open');
  });
  document.getElementById('basketList').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { var hd = e.target.closest('.bi-hd'); if (hd) { e.preventDefault(); hd.parentElement.classList.toggle('open'); } }
  });

  var mask = document.getElementById('basketMask');
  var basket = document.getElementById('basket');
  function openBasket() { renderBasket(); basket.classList.add('open'); mask.classList.add('open'); }
  function closeBasket() { basket.classList.remove('open'); mask.classList.remove('open'); }
  document.getElementById('basketBtn').addEventListener('click', openBasket);
  document.getElementById('basketClose').addEventListener('click', closeBasket);
  mask.addEventListener('click', closeBasket);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBasket(); });

  document.addEventListener('click', function (e) { if (!e.target.closest('.q-lvl')) closePops(); });

  /* ==================== AI 判分引擎 ==================== */
  var serverOk = false;
  var quizState = {};   // cid -> {mode, questions:[], ready:bool}

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return j || {}; }).catch(function () { return { ok: false, error: '响应不是 JSON（HTTP ' + r.status + '）' }; });
    }).catch(function (e) { return { ok: false, error: '无法连接判分服务：' + (e && e.message || e) }; });
  }

  /** 取该题的标准答案文本：一句话 + 展开详情正文 */
  function referenceOf(cid) {
    var card = document.getElementById(cid);
    if (!card) return '';
    var parts = [];
    var gist = card.querySelector('.gist');
    if (gist) parts.push(gist.textContent.trim());
    var body = card.querySelector('.q-body, details, .q-detail');
    if (body) parts.push(body.textContent.replace(/\s+/g, ' ').trim());
    var t = parts.join('\n').replace(/\s+/g, ' ').trim();
    return t;
  }
  /** 取该题的一句话结论（判分时作为最高权重要点单独传给服务端） */
  function gistOf(cid) {
    var card = document.getElementById(cid);
    if (!card) return '';
    var g = card.querySelector('.gist');
    if (!g) return '';
    return g.textContent.replace(/^\s*一句话\s*/, '').replace(/\s+/g, ' ').trim();
  }
  function titleOf(cid) {
    var card = document.getElementById(cid);
    return card && card.querySelector('.q-title') ? card.querySelector('.q-title').textContent.trim() : cid;
  }
  function panelOf(cid) { return document.querySelector('.quiz-panel[data-cid="' + cid + '"]'); }

  /** 刷新某个卡片的面板（等级变化后同步「强制重学」提示） */
  function refreshPanel(cid) {
    var p = panelOf(cid);
    if (p && p.classList.contains('open')) renderStage(cid);
  }

  function panelShell(mode) {
    return '<div class="quiz-tabs">'
      + '<button class="quiz-tab' + (mode === 'quick' ? ' active' : '') + '" data-mode="quick" type="button">快速判分 · 默写复述</button>'
      + '<button class="quiz-tab' + (mode === 'deep' ? ' active' : '') + '" data-mode="deep" type="button">深度自测 · AI 出题</button>'
      + '</div><div class="quiz-stage"></div>';
  }

  /** 把当前面板已输入的内容暂存进状态：面板任何重渲染（切 Tab / 判分失败 / 出题失败）
   *  都会重建 textarea，不先存档的话用户辛苦写的内容就被清空了 */
  function snapshotInputs(cid, st) {
    if (!st) return;
    if (st.mode === 'deep') {
      st.answers = (st.questions || []).map(function (q, i) {
        var el = document.getElementById('qd-' + cid + '-' + i);
        return el ? el.value : ((st.answers && st.answers[i]) || '');
      });
    } else {
      var ta = document.getElementById('qa-' + cid);
      if (ta && ta.value.trim()) st.answer = ta.value;
    }
  }

  function serverDownHtml() {
    return '<div class="quiz-err">判分服务未连接。请先启动服务：双击包内「启动.cmd」（或执行 <code style="font-size:11.5px">node server.js</code>），'
      + '然后用启动窗口里提示的 <b>http://localhost:端口/</b> 地址访问页面（file:// 双击打开会被浏览器拦截）。<br>'
      + '服务未启动时，仍可在右侧「另一个篮子」里手动标记等级。</div>';
  }

  /** 渲染某个卡片的自测面板主体 */
  function renderStage(cid) {
    var p = panelOf(cid);
    if (!p) return;
    var st = quizState[cid] || (quizState[cid] = { mode: 'quick', questions: [], ready: false, loading: false });
    if (!st.mode) st.mode = 'quick';
    if (!p.querySelector('.quiz-tabs')) p.innerHTML = panelShell(st.mode);
    p.querySelectorAll('.quiz-tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-mode') === st.mode); });

    var stage = p.querySelector('.quiz-stage');
    var c = read(cid) || {};

    // 强制重学门槛：上次判为「忘记了」，必须先回顾答案才能复测
    var gateHtml = '';
    if (c.restudy) {
      gateHtml = '<div class="quiz-restudy"><b>触发了强制重学</b>'
        + '本题上次自测判为「忘记了」，已按规则在<b>当天重新到期</b>。请先展开下方答案回顾，然后点「已回顾答案，开始复述」再测一次；'
        + '连续 2 次达到熟练（覆盖率 ≥60%）才会毕业。</div>';
    }

    if (!serverOk && !st.verdict) { stage.innerHTML = serverDownHtml() + gateHtml; return; }

    if (st.loading) { stage.innerHTML = '<div class="quiz-load">DeepSeek 正在出题，约 3~8 秒…</div>'; return; }

    if (st.mode === 'quick') {
      var lock = c.restudy && !st.ready;
      stage.innerHTML = gateHtml
        + '<div class="quiz-q">凭记忆复述这道题（别看答案，能写多少写多少）：</div>'
        + (lock
          ? '<div class="quiz-err">需先回顾答案：点击上方卡片标题展开答案，然后点下面的「已回顾答案，开始复述」。</div>'
          : '<textarea id="qa-' + cid + '" placeholder="例如：new 的过程中，operator new 只分配内存…">' + esc(st.verdict ? '' : (st.answer || '')) + '</textarea>')
        + '<div class="quiz-act">'
        + (lock ? '<button class="quiz-go" data-act="ready" type="button">已回顾答案，开始复述</button>'
          : '<button class="quiz-go" data-act="submit" type="button">提交判分</button>')
        + '<button class="quiz-go" data-act="close" type="button">收起</button>'
        + '</div>'
        + (st.quizErr || '')
        + (st.verdict || '');
    } else {
      var qs = st.questions;
      var body = qs.length
        ? qs.map(function (q, i) {
            return '<div class="quiz-q"><span class="qn">Q' + (i + 1) + '.</span> ' + esc(q.q) + '</div>'
              + '<textarea id="qd-' + cid + '-' + i + '" placeholder="用 1-3 句话回答…">' + esc(st.answers && st.answers[i] ? st.answers[i] : '') + '</textarea>';
          }).join('')
        : '<div class="quiz-load">还没有题目，点下面的按钮让 DeepSeek 出题。</div>';
      var lock2 = c.restudy && !st.ready;
      stage.innerHTML = gateHtml + body
        + '<div class="quiz-act">'
        + '<button class="quiz-go" data-act="gen" type="button">' + (qs.length ? '重新出题' : '让 DeepSeek 出题') + '</button>'
        + (lock2
          ? '<button class="quiz-go" data-act="ready" type="button" style="background:#d97706">已回顾答案，开始作答</button>'
          : '<button class="quiz-go" data-act="judge" type="button">提交判分</button>')
        + '<button class="quiz-go" data-act="close" type="button" style="background:#94a3b8">收起</button>'
        + '</div>'
        + (st.quizErr || '')
        + (st.verdict || '');
    }
  }

  /** 判分结果卡片 */
  function verdictHtml(r, cid) {
    var L = LEVELS[norm(r.level)];
    var cov = Math.max(0, Math.min(100, r.coverage || 0));
    var acc = r.accuracy == null ? null : Math.max(0, Math.min(100, r.accuracy));
    var h = '<div class="verdict">'
      + '<div class="verdict-hd">'
      + '<span class="verdict-lv ' + L.cls + '">' + L.label + '</span>'
      + '<span class="score">' + cov + '<small>要点覆盖率</small></span>'
      + (acc == null ? '' : '<span class="score" style="font-size:15px;color:var(--muted)">' + acc + '<small>表述正确率</small></span>')
      + '</div>'
      + '<div class="covbar"><i style="width:' + cov + '%"></i></div>'
      + '<div class="covmarks"><span>0 忘记了</span><span>30 模糊</span><span>60 熟练</span><span>85 完全掌握</span></div>';

    if (r.gist === true) {
      h += '<div class="v-sec ok">核心结论已命中（一句话结论为最高权重要点，权重≈其余要点之和）</div>';
    } else if (r.gist === false) {
      h += '<div class="v-sec bad">核心结论未命中或说反了——一句话结论权重≈其余要点之和，覆盖率已被压到 55 以下</div>';
    }

    if (r.wrong && r.wrong.length) {
      h += '<div class="v-sec bad">说错了</div><ul class="v-list">' + r.wrong.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }
    if (r.missed && r.missed.length) {
      h += '<div class="v-sec mid">遗漏要点</div><ul class="v-list">' + r.missed.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }
    if (!(r.missed && r.missed.length) && !(r.wrong && r.wrong.length)) {
      h += '<div class="v-sec ok">要点齐全，没有发现明显错误</div>';
    }
    if (r.comment) h += '<div class="v-note">点评：' + esc(r.comment) + '</div>';
    if (r.next) h += '<div class="v-next">下一步：' + esc(r.next) + '</div>';

    var c = read(cid) || {};
    if (r.level === 'forgotten') {
      h += '<div class="gate">已触发强制重学：本题今天必须重新学一遍（先看答案 → 再复述），连续 2 次达标才能毕业。</div>';
    } else if (r.level === 'fuzzy') {
      h += '<div class="gate">模糊档：' + (c.interval || 1) + ' 天后再次复习。注意——模糊不计入达标，需要连续 2 次自测达到熟练以上才毕业。</div>';
    } else if ((c.gate || 0) >= 2) {
      h += '<div class="gate" style="background:#ecfdf5;border-color:#6ee7b7;color:#065f46">连续 2 次达标，已毕业！下次复查安排在 ' + (c.interval || 7) + ' 天后。</div>';
    } else {
      h += '<div class="gate">毕业进度 ' + (c.gate || 0) + '/2 —— 今天再自测一次并达到熟练即可毕业。</div>';
    }
    return h + '</div>';
  }

  /** 统一收尾：写数据 + 刷新界面 */
  function commitVerdict(cid, r) {
    applyVerdict(get(cid), r.level, r.coverage, r.accuracy, false);
    var st = quizState[cid];
    if (st) { st.verdict = verdictHtml(r, cid); st.ready = false; st.quizErr = ''; }
    updateLvlBtn(cid);
    renderStats();
    renderStage(cid);
    renderBasket();
    applyReviewMode();
  }

  function failVerdict(cid, msg) {
    var st = quizState[cid] || (quizState[cid] = { mode: 'quick', questions: [], ready: false });
    st.quizErr = '<div class="quiz-err">判分失败：' + esc(msg) + '</div>';
    renderStage(cid);
  }

  /* —— 面板事件 —— */
  document.addEventListener('click', function (e) {
    var p = e.target.closest('.quiz-panel');
    var tab = e.target.closest('.quiz-tab');
    var btn = e.target.closest('.quiz-btn');

    if (btn && !p) {                                  // 头部入口：开/关面板
      var card = btn.closest('.q');
      var cid = card.id;
      var panel = panelOf(cid);
      var wasOpen = panel.classList.contains('open');
      document.querySelectorAll('.quiz-panel.open').forEach(function (x) { x.classList.remove('open'); });
      if (!wasOpen) {
        var st = quizState[cid] || (quizState[cid] = { mode: btn.getAttribute('data-mode'), questions: [], ready: false });
        if (!st.mode) st.mode = btn.getAttribute('data-mode');
        panel.classList.add('open');
        // 深测进入时自动出题
        if (st.mode === 'deep' && !st.questions.length && serverOk) genQuiz(cid);
        renderStage(cid);
      } else {
        panel.classList.remove('open');
      }
      return;
    }
    if (!p) return;

    var cid = p.getAttribute('data-cid');
    if (tab) {
      var st = quizState[cid] || (quizState[cid] = { mode: 'quick', questions: [], ready: false });
      snapshotInputs(cid, st);                     // 切 Tab 前先存档已输入内容
      st.mode = tab.getAttribute('data-mode');
      st.verdict = ''; st.quizErr = ''; st.ready = false;
      p.querySelectorAll('.quiz-tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-mode') === st.mode); });
      if (st.mode === 'deep' && !st.questions.length && serverOk) genQuiz(cid); else renderStage(cid);
      return;
    }

    var act = e.target.closest('[data-act]');
    if (!act) return;
    var what = act.getAttribute('data-act');

    if (what === 'close') { p.classList.remove('open'); return; }
    if (what === 'ready') {                              // 强制重学：确认已回顾答案
      quizState[cid].ready = true;
      renderStage(cid);
      return;
    }
    if (what === 'gen') { genQuiz(cid); return; }

    if (what === 'submit') {                             // 快速判分
      var ta = document.getElementById('qa-' + cid);
      var ans = ta ? ta.value.trim() : '';
      if (!ans) { failVerdict(cid, '还没来得及写复述内容，先凭记忆写几句再提交。'); return; }
      var stS = quizState[cid] || (quizState[cid] = { mode: 'quick', questions: [], ready: false });
      stS.answer = ans;                                  // 存档：判分失败重渲染时输入不丢
      act.textContent = 'DeepSeek 判分中…';
      act.disabled = true;
      api('/api/judge', { mode: 'quick', question: titleOf(cid), reference: referenceOf(cid), gist: gistOf(cid), answer: ans })
        .then(function (r) {
          act.disabled = false; act.textContent = '提交判分';
          if (!r.ok) { failVerdict(cid, r.error); return; }
          commitVerdict(cid, r);
        })
        .catch(function (e) {                            // 兜底：任何意外异常都给出可见反馈，不把按钮卡在「判分中」
          act.disabled = false; act.textContent = '提交判分';
          failVerdict(cid, (e && e.message) || String(e));
        });
      return;
    }

    if (what === 'judge') {                              // 深度自测判分
      var st2 = quizState[cid];
      var qa = (st2.questions || []).map(function (q, i) {
        var el = document.getElementById('qd-' + cid + '-' + i);
        return { q: q.q, a: q.a, userAnswer: el ? el.value.trim() : '' };
      });
      st2.answers = qa.map(function (x) { return x.userAnswer; });   // 存档：判分失败重渲染时输入不丢
      if (!qa.some(function (x) { return x.userAnswer; })) { failVerdict(cid, '至少回答一题再提交。'); return; }
      act.textContent = 'DeepSeek 判分中…';
      act.disabled = true;
      api('/api/judge', { mode: 'deep', question: titleOf(cid), reference: referenceOf(cid), gist: gistOf(cid), qa: qa })
        .then(function (r) {
          act.disabled = false; act.textContent = '提交判分';
          if (!r.ok) { failVerdict(cid, r.error); return; }
          commitVerdict(cid, r);
        })
        .catch(function (e) {
          act.disabled = false; act.textContent = '提交判分';
          failVerdict(cid, (e && e.message) || String(e));
        });
      return;
    }
  });

  /** 让 DeepSeek 出 3 道题 */
  function genQuiz(cid) {
    var st = quizState[cid] || (quizState[cid] = { mode: 'deep', questions: [], ready: false });
    snapshotInputs(cid, st);                            // 出题失败重渲染时保留已答内容
    st.loading = true; st.quizErr = ''; st.verdict = '';
    renderStage(cid);
    api('/api/quiz', { question: titleOf(cid), reference: referenceOf(cid) })
      .then(function (r) {
        st.loading = false;
        if (!r.ok) { st.quizErr = '<div class="quiz-err">出题失败：' + esc(r.error) + '</div>'; renderStage(cid); return; }
        st.questions = r.questions;
        st.answers = (r.questions || []).map(function () { return ''; });
        renderStage(cid);
      });
  }

  /* —— 初始化 —— */
  injectLvlButtons();
  buildPops();
  refreshLapsed();
  document.querySelectorAll('.q-lvl').forEach(function (box) { updateLvlBtn(box.getAttribute('data-cid')); });
  document.getElementById('reviewModeBtn').addEventListener('click', toggleReviewMode);
  renderStats();
  document.addEventListener('knowledge-filter-change', function () { renderStats(); if (basket.classList.contains('open')) renderBasket(); });
  fetch('/api/health').then(function (r) { return r.json(); }).then(function (j) {
    serverOk = !!(j && j.ok && j.hasKey);
    renderStats();
    document.querySelectorAll('.quiz-btn').forEach(function (b) {
      b.style.opacity = serverOk ? '1' : '.45';
      if (!serverOk) b.title = '判分服务未连接：请先运行 node server.js';
    });
    if (basket.classList.contains('open')) renderBasket();
  }).catch(function () { serverOk = false; renderStats(); });

  var syncState = { pending: null, tab: 'file' };

  window.KnowledgeSync({ db: db, LEVELS: LEVELS, esc: esc, titleOf: titleOf, applyVerdict: applyVerdict, saveDB: saveDB, updateLvlBtn: updateLvlBtn, renderStats: renderStats, applyReviewMode: applyReviewMode, refreshLapsed: refreshLapsed, renderBasket: renderBasket, norm: norm });
})();
