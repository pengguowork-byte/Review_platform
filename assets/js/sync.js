window.KnowledgeSync = function (ctx) {
  var db = ctx.db, LEVELS = ctx.LEVELS, esc = ctx.esc, titleOf = ctx.titleOf;
  var applyVerdict = ctx.applyVerdict, saveDB = ctx.saveDB, updateLvlBtn = ctx.updateLvlBtn, renderStats = ctx.renderStats;
  var applyReviewMode = ctx.applyReviewMode, refreshLapsed = ctx.refreshLapsed, renderBasket = ctx.renderBasket, norm = ctx.norm;
  var syncState = { pending: null, tab: "file" };
  /* ==================== 数据同步：导出 / 导入 ====================
   * 设计目标：手机与电脑各自在本地复习，通过 JSON 文件互相同步。
   * 合并策略（关键）：history 是唯一事实来源。
   *   - 只在一方存在的题 → 直接采用；
   *   - 双方都有的题 → 对保留的事件去重、按时间排序，通过纯算法重放。
   * 新记录保留截断前 checkpoint；旧版本丢弃的历史无法恢复。
   */
  function toast(msg, kind) {
    var t = document.getElementById('syncToast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  /** 归一化一条卡片记录，同时兼容旧版四等级数据 */
  function normalizeCard(c) {
    var n = JSON.parse(JSON.stringify(c || {}));
    if (n.level === 'wrong') n.level = 'forgotten';
    if (Array.isArray(n.history)) n.history.forEach(function (h) { if (h.level === 'wrong') h.level = 'forgotten'; });
    if (n.level && !LEVELS[n.level]) n.level = 'unseen';
    if (!Array.isArray(n.history)) n.history = [];
    if (n.interval == null) n.interval = 0;
    if (n.due == null) n.due = 0;
    if (n.gate == null) n.gate = (n.level === 'skilled') ? 1 : 0;
    if (n.stage == null) n.stage = 0;
    if (n.lapses == null) n.lapses = 0;
    if (n.quizzes == null) n.quizzes = 0;
    if (n.ease == null) n.ease = 2.5;
    return n;
  }
  function evidence(c) { return (c.quizzes || 0) + (c.history ? c.history.length : 0); }
  function sameCard(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }

  /** 把 other 中 base 没有的历史条目，按时间顺序重放到 base 的状态上 */
  function replayExtra(base, other) {
    return window.ReviewEngine.merge(base, other);
  }

  /** 把 src 合并进 target，返回统计。可传入 db.cards 的深拷贝做预览。 */
  function mergeCardsInto(target, src) {
    var st = { added: 0, merged: 0, unchanged: 0, samples: [] };
    Object.keys(src).forEach(function (cid) {
      var raw = src[cid];
      if (!raw || typeof raw !== 'object') return;      // 跳过脏数据
      var s = normalizeCard(raw);
      var mine = target[cid];
      if (!mine || mine.level === undefined) { target[cid] = s; st.added++; pushSample(st, cid, s); return; }
      mine = normalizeCard(mine);
      if (sameCard(mine, s)) { st.unchanged++; return; }
      var base = evidence(mine) >= evidence(s) ? mine : s;
      var other = base === mine ? s : mine;
      var out = replayExtra(base, other);
      if (sameCard(mine, out)) { st.unchanged++; return; }
      target[cid] = out; st.merged++; pushSample(st, cid, out, mine);
    });
    return st;
  }
  function pushSample(st, cid, out, before) {
    if (st.samples.length >= 6) return;
    st.samples.push({ cid: cid, title: titleOf(cid), level: out.level, before: before ? before.level : null, quizzes: out.quizzes || 0 });
  }

  /** 生成导出对象 */
  function buildExport() {
    var cards = {};
    Object.keys(db.cards).forEach(function (cid) {
      var c = db.cards[cid];
      if (c && (c.level || (c.history && c.history.length))) cards[cid] = c;   // 只导出有进度的题
    });
    var meta = { quizzes: 0, sum: 0, n: 0 };
    for (var cid in cards) {
      meta.quizzes += cards[cid].quizzes || 0;
      if (typeof cards[cid].lastScore === 'number') { meta.sum += cards[cid].lastScore; meta.n++; }
    }
    return {
      app: 'eb-review',
      version: 2,
      exportedAt: new Date().toISOString(),
      source: location.hostname || 'local',
      summary: {
        total: document.querySelectorAll('main .q').length,
        exported: Object.keys(cards).length,
        quizzes: meta.quizzes,
        avgScore: meta.n ? Math.round(meta.sum / meta.n) : 0
      },
      cards: cards
    };
  }

  function doExport() {
    var data = buildExport();
    if (!Object.keys(data.cards).length) { toast('本机还没有复习记录，无需导出', 'bad'); return; }
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    var pad = function (x) { return String(x).padStart(2, '0'); };
    a.href = URL.createObjectURL(blob);
    a.download = '知识工作台-复习进度-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出 ' + Object.keys(data.cards).length + ' 条进度，可发到手机后导入', 'ok');
  }

  /** 解析导入内容（兼容 v2 包装与旧版裸 DB） */
  function parseImport(text) {
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { return { error: '不是合法的 JSON：' + e.message }; }
    if (!obj || typeof obj !== 'object') return { error: '文件内容为空或格式不对' };
    var cards = (obj.cards && typeof obj.cards === 'object') ? obj.cards : null;
    if (!cards) return { error: '未找到 cards 字段，请确认是「导出进度」生成的文件' };
    var keys = Object.keys(cards).filter(function (k) { return cards[k] && typeof cards[k] === 'object'; });
    if (!keys.length) return { error: '文件里没有任何学习记录' };
    return {
      cards: cards,
      count: keys.length,
      exportedAt: obj.exportedAt || null,
      source: obj.source || null,
      summary: obj.summary || null
    };
  }

  function fmtWhen(iso) {
    if (!iso) return '未知时间';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '未知时间';
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 预览：在深拷贝上试合并，避免直接改动真实数据 */
  function showPreview(parsed) {
    var target = JSON.parse(JSON.stringify(db.cards));
    var st = mergeCardsInto(target, parsed.cards);
    var html = '<div class="sync-preview"><div class="sp-row">'
      + '<div class="sp-cell"><b>' + st.added + '</b><span>新增</span></div>'
      + '<div class="sp-cell"><b>' + st.merged + '</b><span>合并更新</span></div>'
      + '<div class="sp-cell"><b>' + st.unchanged + '</b><span>无变化</span></div>'
      + '</div><div class="sp-meta">'
      + '文件含 <b>' + parsed.count + '</b> 条记录 · 导出于 ' + fmtWhen(parsed.exportedAt) + ' · 来自 ' + esc(parsed.source || '未知设备')
      + '</div></div>';

    if (st.samples.length) {
      html += '<div class="sync-list">';
      st.samples.forEach(function (s) {
        var from = s.before ? LEVELS[norm(s.before)].label : '无记录';
        var to = LEVELS[norm(s.level)].label;
        html += '<div class="sync-li"><span class="t">' + esc(s.title) + '</span><span class="c">'
          + (s.before ? esc(from) + ' → ' + esc(to) : '新增 · ' + esc(to)) + '</span></div>';
      });
      html += '</div>';
    }
    if (st.merged) {
      html += '<div class="sync-warn">检测到 <b>' + st.merged + '</b> 道题在两个设备上都有复习记录。'
        + '合并方式：合并双方保留的历史，按时间顺序重放 —— <b>最新的判分结果生效</b>，每题保留最近 60 次复习。</div>';
    }
    setResult(html);
    document.getElementById('syncConfirm').disabled = false;
    syncState.pending = parsed;
  }

  function doConfirm() {
    var parsed = syncState.pending;
    if (!parsed) return;
    var st = mergeCardsInto(db.cards, parsed.cards);
    refreshLapsed();
    saveDB();
    document.querySelectorAll('.q-lvl').forEach(function (box) { updateLvlBtn(box.getAttribute('data-cid')); });
    renderStats();
    renderBasket();
    applyReviewMode();
    closeSync();
    if (!st.added && !st.merged) toast('没有需要更新的内容，两端已一致', 'ok');
    else toast('导入完成：新增 ' + st.added + ' · 合并 ' + st.merged + ' · 无变化 ' + st.unchanged, 'ok');
  }

  function openSync() {
    document.getElementById('syncMask').classList.add('open');
    document.getElementById('syncResult').innerHTML = '';
    document.getElementById('syncConfirm').disabled = true;
    syncState.pending = null;
  }
  function closeSync() {
    document.getElementById('syncMask').classList.remove('open');
    document.getElementById('syncText').value = '';
    document.getElementById('syncFile').value = '';
    document.getElementById('syncResult').innerHTML = '';
    document.getElementById('syncConfirm').disabled = true;
    syncState.pending = null;
  }
  function switchSyncTab(t) {
    syncState.tab = t;
    document.getElementById('tabFile').classList.toggle('active', t === 'file');
    document.getElementById('tabPaste').classList.toggle('active', t === 'paste');
    document.getElementById('paneFile').style.display = t === 'file' ? '' : 'none';
    document.getElementById('panePaste').style.display = t === 'paste' ? '' : 'none';
  }
  function setResult(html) {
    var r = document.getElementById('syncResult');
    if (r) r.innerHTML = html;
  }
  function handleSyncText(text) {
    var parsed = parseImport(text);
    if (parsed.error) {
      setResult('<div class="sync-err">解析失败：' + esc(parsed.error) + '</div>');
      document.getElementById('syncConfirm').disabled = true;
      syncState.pending = null;
      return;
    }
    showPreview(parsed);
  }

  /* 容错绑定：节点缺失时跳过，避免单个节点问题中断整个 IIFE */
  function onEl(id, ev, fn) {
    var el = document.getElementById(id);
    if (!el) { console.warn('[sync] 缺少节点 #' + id + '，相关监听未绑定'); return; }
    el.addEventListener(ev, fn);
  }

  onEl('exportBtn', 'click', doExport);
  onEl('importBtn', 'click', openSync);
  onEl('syncClose', 'click', closeSync);
  onEl('syncCancel', 'click', closeSync);
  onEl('syncConfirm', 'click', doConfirm);
  onEl('tabFile', 'click', function () { switchSyncTab('file'); });
  onEl('tabPaste', 'click', function () { switchSyncTab('paste'); });
  onEl('syncParse', 'click', function () {
    var ta = document.getElementById('syncText');
    if (ta) handleSyncText(ta.value.trim());
  });
  onEl('dropzone', 'click', function () {
    var fi = document.getElementById('syncFile');
    if (fi) fi.click();
  });
  onEl('syncFile', 'change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { handleSyncText(String(reader.result || '')); };
    reader.onerror = function () { setResult('<div class="sync-err">文件读取失败</div>'); };
    reader.readAsText(f, 'utf-8');
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    onEl('dropzone', ev, function (e) { e.preventDefault(); this.classList.add('hot'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    onEl('dropzone', ev, function (e) { e.preventDefault(); this.classList.remove('hot'); });
  });
  onEl('dropzone', 'drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { handleSyncText(String(reader.result || '')); };
    reader.readAsText(f, 'utf-8');
  });
  onEl('syncMask', 'click', function (e) { if (e.target === this) closeSync(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('syncMask').classList.contains('open')) closeSync();
  });
  // 自检：把缺失节点一次说清楚，而不是运行到一半才炸
  ['syncMask', 'syncResult', 'syncConfirm', 'syncText', 'syncFile', 'dropzone', 'tabFile', 'tabPaste', 'syncParse', 'syncToast', 'exportBtn', 'importBtn'].forEach(function (id) {
    if (!document.getElementById(id)) console.error('[sync] 关键节点缺失 #' + id);
  });

};
