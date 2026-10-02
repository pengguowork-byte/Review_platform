
/* ============================================================================
 * 文件导入与内容提取工作台
 * 流水线：格式/大小/魔数校验 → 本地提取（pdf.js / mammoth / tesseract.js）
 *        → 分块（≤2000 字符，带页码）→ DeepSeek 知识点/题库（/api/kpoints、/api/qbank）
 *        → IndexedDB 持久化（eb-extract-v1）→ 预览/编辑/分类/导出（JSON/CSV/Excel）
 * 原则：原文解析全部在浏览器本地完成，只有「提炼/出题」才会把分块文本发给服务端。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var CDN = {
    pdfjs:    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
    pdfWorker:'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
    mammoth:  'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
    tesseract:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    xlsx:     'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  };
  var ACCEPT = { pdf: 'pdf', docx: 'docx', jpg: 'img', jpeg: 'img', png: 'img', gif: 'img' };
  var MAX_SIZE = 50 * 1024 * 1024;   // 单文件 50MB 上限
  var OCR_PAGE_LIMIT = 30;           // 单文件 OCR 页数上限（性能护栏）
  var OCR_TRIGGER = 50;              // 页文本少于该字符数视为扫描页，触发 OCR
  var CONCURRENCY = 2;               // 提取并发数
  var CHUNK_SIZE = 2000;             // 分块字符上限
  var OCR_DPI = 150;                 // OCR 渲染分辨率上限
  var DB_NAME = 'eb-extract-v1';
  var DB_VERSION = 1;
  var KP_TYPES = ['定义', '概念', '原理', '公式', '易错点'];
  var Q_TYPES = ['选择题', '填空题', '简答题'];

  /* ---------------- 状态 ---------------- */
  var st = {
    files: [],      // {id,name,size,kind,ext,status,progress,note,pageCount,ocrPages,failedPages,textLength}
    blocks: [],     // {id?,fileId,pageFrom,pageTo,text,isOcr}
    points: [],     // {id,fileId,type,title,content,page,confidence,status,tags}
    questions: [],  // {id,fileId,type,question,options[],answer,explanation,page,confidence,status,tags}
    tab: 'import',  // import / progress / result
    sub: 'kp',      // kp / q
    filterFile: '',
    busy: false,    // 知识点/题库生成进行中锁
    lib: { pdfjs: null, mammoth: null, tesseract: null, xlsx: null },
    db: null,
    ready: false    // restore() 完成标志（外部等待恢复结束后再操作状态）
  };
  window.EX = st;   // 供控制台与自动化测试检查内部状态

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('exToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'exToast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function log(msg) {
    var box = $('exLog');
    if (!box) return;
    var d = document.createElement('div');
    d.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + msg;
    box.appendChild(d);
    while (box.children.length > 120) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function onEl(id, ev, fn) {
    var el = $(id);
    if (el) el.addEventListener(ev, fn);
  }

  /* ---------------- IndexedDB ---------------- */
  var extractStorage = window.extractStorage({ st, DB_NAME, DB_VERSION });
  var idbOpen = extractStorage.idbOpen;
  var idbAll = extractStorage.idbAll;
  var idbPut = extractStorage.idbPut;
  var idbPutAll = extractStorage.idbPutAll;
  var idbDelete = extractStorage.idbDelete;
  var idbClearAll = extractStorage.idbClearAll;

  var extractParsers = window.extractParsers({ st, CDN, ACCEPT, MAX_SIZE, OCR_PAGE_LIMIT, OCR_TRIGGER, OCR_DPI, CHUNK_SIZE, log, fmtSize });
  var loadScript = extractParsers.loadScript;
  var validateFile = extractParsers.validateFile;
  var extractPdf = extractParsers.extractPdf;
  var extractDocx = extractParsers.extractDocx;
  var extractImages = extractParsers.extractImages;
  var buildChunks = extractParsers.buildChunks;

  function fileById(id) {
    for (var i = 0; i < st.files.length; i++) if (st.files[i].id === id) return st.files[i];
    return null;
  }
  function activeCount() {
    return st.files.filter(function (f) { return f.status === 'run'; }).length;
  }
  async function handleFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    var accepted = 0;
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i];
      var v = await validateFile(f);
      var rec = {
        id: 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        name: f.name,
        categoryId: $('exCategory').value,
        size: f.size,
        ext: v.ok ? v.ext : (f.name.split('.').pop() || '').toLowerCase(),
        kind: v.ok ? v.kind : '',
        status: v.ok ? 'wait' : 'err',
        progress: v.ok ? 0 : 1,
        note: v.ok ? '' : v.err,
        pageCount: 0, ocrPages: 0, failedPages: [], textLength: 0,
        file: f,   // File 对象仅驻留内存，不写入 IndexedDB
        addedAt: Date.now()
      };
      if (v.ok) accepted++;
      st.files.push(rec);
      if (!v.ok) log('跳过 ' + f.name + '：' + v.err);
    }
    renderQueue();
    if (accepted) toast('已加入 ' + accepted + ' 个文件，点「开始提取」', 'ok');
  }

  async function extractOne(f) {
    f.status = 'run';
    f.progress = 0;
    renderQueueRow(f);
    log('开始提取：' + f.name);
    var t0 = Date.now();
    try {
      var blocks;
      if (f.kind === 'pdf') blocks = await extractPdf(f, function (ratio, msg) { setFileProgress(f, ratio, msg); });
      else if (f.kind === 'docx') blocks = await extractDocx(f, function (ratio, msg) { setFileProgress(f, ratio, msg); });
      else blocks = await extractImages(f, function (ratio, msg) { setFileProgress(f, ratio, msg); });

      var chunks = buildChunks(blocks, f.id);
      chunks.forEach(function (c) { st.blocks.push(c); });
      f.textLength = chunks.reduce(function (s, c) { return s + c.text.length; }, 0);
      f.progress = 1;

      if (f.failedPages && f.failedPages.length) {
        f.status = 'warn';
        f.note = 'OCR 跳过 ' + f.failedPages.length + ' 页（上限 ' + OCR_PAGE_LIMIT + '）';
      } else {
        f.status = 'ok';
        f.note = '';
      }
      log('完成：' + f.name + '（' + f.pageCount + ' 页 / OCR ' + f.ocrPages + ' 页 / ' + chunks.length + ' 块 / ' + fmtSize(f.textLength) + ' 字符 / ' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');

      // 持久化：文件记录（不含 File 对象）+ 分块
      var rec = Object.assign({}, f);
      delete rec.file; delete rec.worker;
      await idbPut('files', rec);
      if (chunks.length) await idbPutAll('blocks', chunks);
    } catch (e) {
      f.status = 'err';
      f.progress = 1;
      f.note = String((e && e.message) || e);
      log('失败：' + f.name + ' —— ' + f.note);
    }
    renderQueueRow(f);
    renderStats();
    pumpQueue();
  }
  /** 并发泵：保持最多 CONCURRENCY 个文件同时提取 */
  function pumpQueue() {
    while (activeCount() < CONCURRENCY) {
      var next = null;
      for (var i = 0; i < st.files.length; i++) {
        if (st.files[i].status === 'wait') { next = st.files[i]; break; }
      }
      if (!next) break;
      extractOne(next);   // 同步置 status='run'，因此下一次 while 判断不会重复选中
    }
    if (activeCount() === 0) {
      var done = st.files.filter(function (f) { return f.status === 'ok' || f.status === 'warn'; }).length;
      if (done && st.files.length) { toast('提取完成，可切换到「知识点 / 题库」', 'ok'); log('队列全部完成'); }
    }
  }
  function setFileProgress(f, ratio, msg) {
    f.progress = Math.max(0, Math.min(1, ratio || 0));
    f.note = msg || f.note;
    renderQueueRow(f);
  }
  function startExtract() {
    var wait = st.files.filter(function (f) { return f.status === 'wait'; }).length;
    if (!wait) { toast('没有待提取的文件', 'bad'); return; }
    switchTab('progress');
    pumpQueue();
  }
  function removeFile(id) {
    var f = fileById(id);
    if (f && f.worker) { try { f.worker.terminate(); } catch (e) {} }
    if (f && f.status === 'run') { f.cancelled = true; }
    // 先取出该文件的块，再从内存移除（否则下面 filter 之后已经是空集，IDB 里的块删不掉）
    var owned = st.blocks.filter(function (b) { return b.fileId === id; });
    st.files = st.files.filter(function (x) { return x.id !== id; });
    st.blocks = st.blocks.filter(function (b) { return b.fileId !== id; });
    st.points = st.points.filter(function (p) { return p.fileId !== id; });
    st.questions = st.questions.filter(function (q) { return q.fileId !== id; });
    if (st.db) {
      idbDelete('files', id);
      owned.forEach(function (b) { idbDelete('blocks', b.id); });
    }
    renderQueue();
    renderStats();
    renderResultCounts();
    renderResult();
    log('已移除：' + (f ? f.name : id));
  }

  /* ---------------- 渲染：队列 ---------------- */
  var ST_TEXT = { wait: '等待中', run: '提取中', ok: '已完成', warn: '部分跳过', err: '失败' };
  function renderQueue() {
    var body = $('exQueueBody');
    if (!body) return;
    body.innerHTML = st.files.map(function (f) {
      return renderQueueRowHtml(f);
    }).join('');
    $('exQueueEmpty').style.display = st.files.length ? 'none' : '';
    var wait = st.files.filter(function (f) { return f.status === 'wait'; }).length;
    $('exStart').disabled = !wait;
    renderStats();
  }
  function renderQueueRowHtml(f) {
    var info = f.status === 'wait' ? '待提取'
      : f.status === 'run' ? esc(f.note || '提取中')
      : (f.pageCount ? (f.pageCount + ' 页') : '') +
        (f.ocrPages ? (' · OCR ' + f.ocrPages + ' 页') : '') +
        (f.textLength ? (' · ' + fmtSize(f.textLength) + ' 字符') : '');
    return '<tr data-id="' + f.id + '">' +
      '<td><div class="ex-fname" title="' + esc(f.name) + '">' + esc(f.name) + '</div></td>' +
      '<td style="white-space:nowrap;color:var(--muted)">' + fmtSize(f.size) + '</td>' +
      '<td><span class="ex-st ' + f.status + '">' + (ST_TEXT[f.status] || f.status) + '</span></td>' +
      '<td><div class="ex-bar' + (f.status === 'err' ? ' err' : '') + '"><i style="width:' + Math.round((f.progress || 0) * 100) + '%"></i></div></td>' +
      '<td style="font-size:11px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(info + (f.note ? '｜' + f.note : '')) + '">' + esc(info) + '</td>' +
      '<td><button class="ex-x" data-del="' + f.id + '" title="移除">✕</button></td>' +
      '</tr>';
  }
  function renderQueueRow(f) {
    var row = document.querySelector('#exQueueBody tr[data-id="' + f.id + '"]');
    if (!row) { renderQueue(); return; }
    var tmp = document.createElement('tbody');
    tmp.innerHTML = renderQueueRowHtml(f);
    row.parentNode.replaceChild(tmp.firstChild, row);
  }
  function renderStats() {
    var done = st.files.filter(function (f) { return f.status === 'ok' || f.status === 'warn' || f.status === 'err'; }).length;
    var chars = st.files.reduce(function (s, f) { return s + (f.textLength || 0); }, 0);
    var ocr = st.files.reduce(function (s, f) { return s + (f.ocrPages || 0); }, 0);
    $('exStTotal').textContent = String(st.files.length);
    $('exStDone').textContent = String(done);
    $('exStChars').textContent = String(chars);
    $('exStOcr').textContent = String(ocr);
    $('exStBlocks').textContent = String(st.blocks.length);
    var ratio = st.files.length ? done / st.files.length : 0;
    $('exTotalBarI').style.width = Math.round(ratio * 100) + '%';
  }

  /* ---------------- 页签 / 弹窗 ---------------- */
  function switchTab(name) {
    st.tab = name;
    $('exTabImport').classList.toggle('active', name === 'import');
    $('exTabProgress').classList.toggle('active', name === 'progress');
    $('exTabResult').classList.toggle('active', name === 'result');
    $('exPaneImport').style.display = name === 'import' ? '' : 'none';
    $('exPaneProgress').style.display = name === 'progress' ? '' : 'none';
    $('exPaneResult').style.display = name === 'result' ? '' : 'none';
    if (name === 'result') renderResult();
  }
  function openMask() {
    var selected = window.KnowledgeLibrary.getCategory();
    if (selected) $('exCategory').value = selected;
    $('exMask').classList.add('open');
    renderQueue();
    renderResultCounts();
  }
  function closeMask() { $('exMask').classList.remove('open'); }

  /* ================= 结果区：生成 / 编辑 / 分类 / 导出 ================= */
  function fileNameOf(id) {
    var f = fileById(id);
    return f ? f.name : '（文件已移除）';
  }
  function pageLabelOf(item) {
    if (!item.page) return '';
    var f = fileById(item.fileId);
    return f && f.kind === 'docx' ? '§' + item.page : 'P' + item.page;
  }
  function confCls(c) { return c >= 0.85 ? 'hi' : (c >= 0.6 ? 'mid' : 'lo'); }
  function filesWithBlocks() {
    var ids = [];
    st.blocks.forEach(function (b) { if (ids.indexOf(b.fileId) < 0) ids.push(b.fileId); });
    return ids;
  }
  function chunksOfFile(fileId, limit) {
    return st.blocks.filter(function (b) { return b.fileId === fileId; })
      .slice(0, limit || undefined)
      .map(function (b) { return { pageFrom: b.pageFrom, pageTo: b.pageTo, text: b.text, isOcr: !!b.isOcr }; });
  }
  function charsOf(chunks) {
    return chunks.reduce(function (s, c) { return s + String(c.text || '').length; }, 0);
  }
  async function callApi(url, payload) {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var j = null;
    try { j = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
    if (!r.ok || !j || j.ok !== true) {
      throw new Error((j && j.error) || ('服务端 HTTP ' + r.status + '（请确认已通过 node server.js 启动，而不是 file:// 直接打开）'));
    }
    return j;
  }
  /** 编辑防抖：连续输入只会在停顿 400ms 后写一次 IndexedDB */
  var savingTimers = {};
  function persistRow(store, row) {
    if (!st.db) return;
    clearTimeout(savingTimers[row.id]);
    savingTimers[row.id] = setTimeout(function () {
      idbPut(store, row).catch(function (e) { console.error('[extract] 持久化失败', store, row.id, e); });
    }, 400);
  }

  /* ---------- 生成 ---------- */
  var failedJobs = [];
  async function generate(kind,retry) {
    if(st.busy)return;
    var jobs=retry?failedJobs.filter(function(j){return j.kind===kind;}):(st.filterFile?[st.filterFile]:filesWithBlocks()).map(function(id){return {kind:kind,id:id,blocks:chunksOfFile(id)};}).filter(function(j){return j.blocks.length;});
    if(!jobs.length){toast('没有可用的文本块或失败批次','bad');return;}
    st.busy=true;var btn=$(kind==='kp'?'exGenKp':'exGenQ'),added=0,covered=0,total=jobs.reduce(function(n,j){return n+j.blocks.length;},0);
    failedJobs=failedJobs.filter(function(j){return j.kind!==kind;});btn.disabled=true;
    try{for(var job of jobs){
      var collection=kind==='kp'?st.points:st.questions,store=kind==='kp'?'points':'questions';
      var seen=new Set(collection.filter(function(x){return x.fileId===job.id;}).map(window.ExtractGeneration.key));
      var result=await window.ExtractGeneration.run(job.blocks,async function(blocks){
        var pts=st.points.filter(function(p){return p.fileId===job.id&&blocks.some(function(b){return !p.page||(p.page>=b.pageFrom&&p.page<=b.pageTo);});}).slice(0,20);
        var response=await callApi(kind==='kp'?'/api/kpoints':'/api/qbank',{chunks:blocks,points:pts});return kind==='kp'?response.points:response.questions;
      },async function(rows,blocks){
        var fresh=[];rows.forEach(function(row){var key=window.ExtractGeneration.key(row);if(seen.has(key)||fresh.some(function(x){return window.ExtractGeneration.key(x)===key;}))return;fresh.push(Object.assign({},row,{id:(kind==='kp'?'kp-':'q-')+crypto.randomUUID(),fileId:job.id,categoryId:fileById(job.id).categoryId,status:'待确认',tags:[],page:row.page||blocks[0].pageFrom}));});
        if(st.db&&fresh.length)await idbPutAll(store,fresh);fresh.forEach(function(row){seen.add(window.ExtractGeneration.key(row));});collection.push.apply(collection,fresh);added+=fresh.length;renderResult();
      },function(progress){btn.textContent='已处理 '+(covered+progress.done)+'/'+total+' 文本块';});
      covered+=result.done;result.failures.forEach(function(f){failedJobs.push({kind:kind,id:job.id,blocks:f.blocks});log('失败批次：'+fileNameOf(job.id)+' 第 '+f.blocks[0].pageFrom+' 页：'+f.message);});
    }}finally{st.busy=false;btn.disabled=false;btn.textContent=kind==='kp'?'提炼知识点':'生成题库';}
    var report='文本覆盖 '+covered+'/'+total+' 块；新增 '+added+' 条；失败 '+failedJobs.filter(function(j){return j.kind===kind;}).length+' 批。';
    $('exCoverage').textContent=report;log(report);st.sub=kind;switchTab('result');renderResult();toast(report,covered===total?'ok':'bad');
  }
  function genKp(){return generate('kp',false);}
  function genQ(){return generate('q',false);}

  /* ---------- 渲染 ---------- */
  function renderResultCounts() {
    $('exKpCount').textContent = String(st.points.length);
    $('exQCount').textContent = String(st.questions.length);
    var has = st.points.length || st.questions.length;
    $('exResultEmpty').style.display = has ? 'none' : '';
    $('exResultEmpty').innerHTML = st.blocks.length
      ? '还没有提炼结果<br>已有 ' + st.blocks.length + ' 个文本块，点上方「提炼知识点」或「生成题库」开始（需服务端提供 DeepSeek 代理）'
      : '还没有提取结果<br>先在「导入文件」放入 PDF / Word / 图片并完成提取，再点「提炼知识点」或「生成题库」';
    var html = '<span data-f="" class="' + (st.filterFile ? '' : 'pri') + '">全部文件</span>' + st.files.map(function (f) {
      return '<span data-f="' + f.id + '" class="' + (st.filterFile === f.id ? 'pri' : '') + '" title="' + esc(f.name) + '">' + esc(f.name.length > 14 ? f.name.slice(0, 13) + '…' : f.name) + '</span>';
    }).join('');
    $('exFileFilter').innerHTML = html;
    $('exSubKp').classList.toggle('pri', st.sub === 'kp');
    $('exSubQ').classList.toggle('pri', st.sub === 'q');
  }
  function kpHtml(p) {
    var tags = (p.tags || []).join('、');
    return '<div class="ex-item' + (p.confidence < 0.6 ? ' low' : '') + '" data-kp="' + p.id + '">' +
      '<div class="ex-item-top">' +
        '<input class="ttl" data-f="title" value="' + esc(p.title) + '" placeholder="知识点标题" />' +
        '<select data-f="type">' + KP_TYPES.map(function (t) {
          return '<option' + (t === p.type ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select>' +
        '<span class="ex-conf ' + confCls(p.confidence) + '" title="模型自评信心，不代表准确率；请核对来源原文">自评 ' + Math.round(p.confidence * 100) + '%</span>' +
        '<button class="ex-chip" data-act="status">' + (p.status === '已确认' ? '已确认 ✓' : '待确认') + '</button>' +
        '<button class="ex-chip" data-act="source">核对来源原文</button><button class="ex-chip" data-act="del">删除</button>' +
      '</div>' +
      '<textarea class="ex-item-body" data-f="content" rows="3" placeholder="知识点内容">' + esc(p.content) + '</textarea>' +
      '<div class="ex-item-foot">' +
        '<span class="pg">来源：' + esc(fileNameOf(p.fileId)) + (pageLabelOf(p) ? ' · ' + pageLabelOf(p) : '') + '</span>' +
        '<span class="ex-tag">' + esc(tags || '未分类') + '</span>' +
        '<input class="ex-tagin" data-f="tags" value="' + esc(tags) + '" placeholder="标签，用、分隔" />' +
      '</div>' +
    '</div>';
  }
  function qHtml(q) {
    var opts = (q.options || []).join('\n');
    var tags = (q.tags || []).join('、');
    return '<div class="ex-item' + (q.confidence < 0.6 ? ' low' : '') + '" data-q="' + q.id + '">' +
      '<div class="ex-item-top">' +
        '<select data-f="type">' + Q_TYPES.map(function (t) {
          return '<option' + (t === q.type ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select>' +
        '<span class="ex-conf ' + confCls(q.confidence) + '" title="模型自评信心，不代表准确率；请核对来源原文">自评 ' + Math.round(q.confidence * 100) + '%</span>' +
        '<button class="ex-chip" data-act="status">' + (q.status === '已确认' ? '已确认 ✓' : '待确认') + '</button>' +
        '<button class="ex-chip" data-act="source">核对来源原文</button><button class="ex-chip" data-act="del">删除</button>' +
      '</div>' +
      '<textarea class="ex-item-body" data-f="question" rows="2" placeholder="题干">' + esc(q.question) + '</textarea>' +
      (q.type === '选择题' ? '<textarea class="ex-item-body" data-f="options" rows="4" placeholder="每行一个选项，共 4 个">' + esc(opts) + '</textarea>' : '') +
      '<div class="ex-ans"><b>答案：</b><textarea class="ex-item-body" data-f="answer" rows="2" style="background:transparent;box-shadow:none;padding:2px 0;min-height:0">' + esc(q.answer) + '</textarea></div>' +
      '<textarea class="ex-item-body" data-f="explanation" rows="1" placeholder="解析（可选）">' + esc(q.explanation || '') + '</textarea>' +
      '<div class="ex-item-foot">' +
        '<span class="pg">来源：' + esc(fileNameOf(q.fileId)) + (pageLabelOf(q) ? ' · ' + pageLabelOf(q) : '') + '</span>' +
        '<span class="ex-tag">' + esc(tags || '未分类') + '</span>' +
        '<input class="ex-tagin" data-f="tags" value="' + esc(tags) + '" placeholder="标签，用、分隔" />' +
      '</div>' +
    '</div>';
  }
  function renderResult() {
    renderResultCounts();
    var list = $('exResultList');
    var items = st.sub === 'kp' ? st.points : st.questions;
    items = items.filter(function (x) { return !st.filterFile || x.fileId === st.filterFile; });
    list.innerHTML = items.map(function (x) { return st.sub === 'kp' ? kpHtml(x) : qHtml(x); }).join('');
  }

  /* ---------- 编辑/分类事件 ---------- */
  function findRow(id) {
    var p = st.points.filter(function (x) { return x.id === id; })[0];
    if (p) return { row: p, store: 'points' };
    var q = st.questions.filter(function (x) { return x.id === id; })[0];
    return q ? { row: q, store: 'questions' } : null;
  }
  function bindResultEvents() {
    onEl('exSubKp', 'click', function () { st.sub = 'kp'; renderResult(); });
    onEl('exSubQ', 'click', function () { st.sub = 'q'; renderResult(); });
    onEl('exGenKp', 'click', genKp);
    onEl('exGenQ', 'click', genQ);
    onEl('exRetry', 'click', function(){generate(st.sub,true);});
    onEl('exConfirmAll', 'click', function () {
      var rows = (st.sub === 'kp' ? st.points : st.questions).filter(function (x) { return !st.filterFile || x.fileId === st.filterFile; });
      if (!rows.length) { toast('当前列表为空', 'bad'); return; }
      rows.forEach(function (r) { r.status = '已确认'; persistRow(st.sub === 'kp' ? 'points' : 'questions', r); });
      renderResult();
      toast('已确认 ' + rows.length + ' 条', 'ok');
    });
    // 文件筛选
    onEl('exFileFilter', 'click', function (e) {
      var sp = e.target.closest('span[data-f]');
      if (!sp) return;
      st.filterFile = sp.getAttribute('data-f') || '';
      renderResult();
    });
    // 列表内点击：状态切换 / 删除
    onEl('exResultList', 'click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var item = btn.closest('[data-kp],[data-q]');
      if (!item) return;
      var id = item.getAttribute('data-kp') || item.getAttribute('data-q');
      var hit = findRow(id);
      if (!hit) return;
      var act = btn.getAttribute('data-act');
      if(act==='source'){var d=document.getElementById('extractSourceDialog');if(!d){d=document.createElement('dialog');d.id='extractSourceDialog';d.className='knowledge-dialog';d.setAttribute('aria-label','来源原文');var h=document.createElement('h2');h.textContent='来源原文';var close=document.createElement('button');close.textContent='关闭';close.onclick=function(){d.close();};var text=document.createElement('pre');text.id='extractSourceText';text.style.whiteSpace='pre-wrap';d.append(h,close,text);document.body.append(d);}var blocks=st.blocks.filter(function(b){return b.fileId===hit.row.fileId&&(!hit.row.page||(hit.row.page>=b.pageFrom&&hit.row.page<=b.pageTo));});document.getElementById('extractSourceText').textContent=fileNameOf(hit.row.fileId)+' · 模型自评不代表准确率，请核对原文（OCR 文本仍可能有识别误差）\n\n'+(blocks.map(function(b){return '第 '+b.pageFrom+'–'+b.pageTo+' 页\n'+b.text;}).join('\n\n')||'该页没有可用的提取文本，请在原始资料中核对。');d.showModal();}else if (act === 'status') {
        hit.row.status = hit.row.status === '已确认' ? '待确认' : '已确认';
        persistRow(hit.store, hit.row);
        renderResult();
      } else if (act === 'del') {
        if (hit.store === 'points') st.points = st.points.filter(function (x) { return x.id !== id; });
        else st.questions = st.questions.filter(function (x) { return x.id !== id; });
        if (st.db) idbDelete(hit.store, id);
        renderResult();
        toast('已删除');
      }
    });
    // 列表内输入：标题/内容/题型/选项/答案/解析/标签
    onEl('exResultList', 'input', function (e) {
      var el = e.target;
      var field = el.getAttribute && el.getAttribute('data-f');
      if (!field) return;
      var item = el.closest('[data-kp],[data-q]');
      if (!item) return;
      var id = item.getAttribute('data-kp') || item.getAttribute('data-q');
      var hit = findRow(id);
      if (!hit) return;
      var v = el.value;
      if (field === 'options') {
        hit.row.options = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      } else if (field === 'tags') {
        hit.row.tags = v.split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      } else if (field === 'type') {
        hit.row.type = v;
        renderResult();   // 题型变化影响选项编辑区显隐
      } else {
        hit.row[field] = v;
      }
      persistRow(hit.store, hit.row);
    });
    // 导出
    onEl('exExportJson', 'click', exportJson);
    onEl('exExportCsv', 'click', exportCsv);
    onEl('exExportXlsx', 'click', exportXlsx);
    onEl('exExportLibrary', 'click', extractExports.exportLibrary);
    onEl('exAddLibrary', 'click', extractExports.addToLibrary);
  }

  /* ---------- 导出 ---------- */
  var extractExports = window.extractExports({ st, $, toast, fileNameOf, pageLabelOf, loadScript, CDN });
  var exportJson = extractExports.exportJson;
  var exportCsv = extractExports.exportCsv;
  var exportXlsx = extractExports.exportXlsx;

  function bind() {
    window.KnowledgeLibrary.categories.forEach(function (c) { $('exCategory').add(new Option(c.name, c.id)); });
    document.addEventListener('knowledge-names-change', function () {
      var selected = $('exCategory').value;
      $('exCategory').replaceChildren();
      window.KnowledgeLibrary.categories.forEach(function (c) { $('exCategory').add(new Option(c.name,c.id)); });
      $('exCategory').value = selected;
    });
    bindResultEvents();
    document.addEventListener('knowledge-open-extraction', openMask);
    onEl('exClose', 'click', closeMask);
    onEl('exMask', 'click', function (e) { if (e.target === this) closeMask(); });
    onEl('exTabImport', 'click', function () { switchTab('import'); });
    onEl('exTabProgress', 'click', function () { switchTab('progress'); });
    onEl('exTabResult', 'click', function () { switchTab('result'); });
    onEl('exStart', 'click', startExtract);
    onEl('exClear', 'click', function () {
      st.files.slice().forEach(function (f) { removeFile(f.id); });
      if (st.db) idbClearAll();
      renderQueue();
      renderResult();
      toast('工作台已清空');
    });
    onEl('exDrop', 'click', function () { $('exFile').click(); });
    onEl('exFile', 'change', function () {
      handleFiles(this.files);
      this.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      onEl('exDrop', ev, function (e) { e.preventDefault(); this.classList.add('hot'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      onEl('exDrop', ev, function (e) { e.preventDefault(); this.classList.remove('hot'); });
    });
    onEl('exDrop', 'drop', function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) handleFiles(dt.files);
    });
    onEl('exQueueBody', 'click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (btn) removeFile(btn.getAttribute('data-del'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('exMask').classList.contains('open')) closeMask();
    });
  }

  /* ---------------- 启动：恢复上次会话 ---------------- */
  async function restore() {
    try {
      st.db = await idbOpen();
      var files = await idbAll('files');
      var blocks = await idbAll('blocks');
      var points = await idbAll('points');
      var questions = await idbAll('questions');
      files.sort(function (a, b) { return (a.addedAt || 0) - (b.addedAt || 0); });
      st.files = files.map(function (f) {
        // 上次未完成提取的回到「等待中」，File 对象已丢失需重新选择
        var run = f.status === 'wait' || f.status === 'run';
        return Object.assign({}, f, {
          status: run ? 'wait' : f.status,
          note: run ? '重新导入该文件后可再次提取' : (f.note || '')
        });
      });
      st.blocks = blocks.sort(function (a, b) { return a.id - b.id; });
      st.points = points;
      st.questions = questions;
      if (st.files.length || st.blocks.length) {
        log('已从本地数据库恢复：' + st.files.length + ' 个文件 / ' + st.blocks.length + ' 块 / ' + st.points.length + ' 个知识点 / ' + st.questions.length + ' 道题');
      }
    } catch (e) {
      console.error('[extract] IndexedDB 打开失败：', e);
      st.db = null;
    }
    renderQueue();
    renderResultCounts();
    st.ready = true;   // 恢复完成，外部（自动化测试）可安全操作状态
  }

  bind();
  restore();
})();
