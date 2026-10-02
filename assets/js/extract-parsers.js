window.extractParsers = function (ctx) {
  var st = ctx.st;
  var CDN = ctx.CDN;
  var ACCEPT = ctx.ACCEPT;
  var MAX_SIZE = ctx.MAX_SIZE;
  var OCR_PAGE_LIMIT = ctx.OCR_PAGE_LIMIT;
  var OCR_TRIGGER = ctx.OCR_TRIGGER;
  var OCR_DPI = ctx.OCR_DPI;
  var CHUNK_SIZE = ctx.CHUNK_SIZE;
  var log = ctx.log;
  var fmtSize = ctx.fmtSize;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('CDN 资源加载失败（需联网）：' + src)); };
      document.head.appendChild(s);
    });
  }
  async function getPdfjs() {
    if (st.lib.pdfjs) return st.lib.pdfjs;
    var mod = await import(CDN.pdfjs);   // pdf.js v4 为 ES Module；module worker 支持跨域 CORS
    mod.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    st.lib.pdfjs = mod;
    return mod;
  }
  async function getMammoth() {
    if (st.lib.mammoth) return st.lib.mammoth;
    await loadScript(CDN.mammoth);
    st.lib.mammoth = window.mammoth;
    if (!st.lib.mammoth) throw new Error('mammoth 加载后未暴露全局对象');
    return st.lib.mammoth;
  }
  async function getTesseract() {
    if (st.lib.tesseract) return st.lib.tesseract;
    await loadScript(CDN.tesseract);
    st.lib.tesseract = window.Tesseract;
    if (!st.lib.tesseract) throw new Error('tesseract.js 加载后未暴露全局对象');
    return st.lib.tesseract;
  }

  /* ---------------- 文件校验 ---------------- */
  var MAGIC = [
    { kind: 'pdf',  bytes: [0x25, 0x50, 0x44, 0x46] },        // %PDF
    { kind: 'zip',  bytes: [0x50, 0x4b, 0x03, 0x04] },        // PK..（docx 本质是 zip）
    { kind: 'ole',  bytes: [0xd0, 0xcf, 0x11, 0xe0] },        // 旧版 .doc（OLE2）
    { kind: 'jpg',  bytes: [0xff, 0xd8, 0xff] },
    { kind: 'png',  bytes: [0x89, 0x50, 0x4e, 0x47] },
    { kind: 'gif',  bytes: [0x47, 0x49, 0x46, 0x38] }         // GIF8
  ];
  async function sniff(head8) {
    for (var i = 0; i < MAGIC.length; i++) {
      var m = MAGIC[i];
      var hit = m.bytes.every(function (b, j) { return head8[j] === b; });
      if (hit) return m.kind;
    }
    return '';
  }
  /** 校验单个文件；返回 {ok, err} —— ok 时附带归一化后的 kind/ext */
  async function validateFile(file) {
    var dot = file.name.lastIndexOf('.');
    var ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
    // 旧版 .doc 提前识别并给出可操作的提示（它的魔数是 OLE2，与 docx 的 ZIP 完全不同）
    if (ext === 'doc') {
      return { ok: false, err: '这是旧版 .doc（OLE2 格式），请先用 Word「另存为」.docx 再导入' };
    }
    if (!ACCEPT[ext]) {
      return { ok: false, err: '不支持的格式「.' + (ext || '无后缀') + '」（仅支持 pdf/docx/jpg/jpeg/png/gif）' };
    }
    if (file.size > MAX_SIZE) {
      return { ok: false, err: '文件 ' + fmtSize(file.size) + '，超过 50MB 上限' };
    }
    var head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    var magic = await sniff(head);
    var kind = ACCEPT[ext];
    if (kind === 'pdf' && magic !== 'pdf') return { ok: false, err: '文件头不是 %PDF-，可能是伪装的 PDF' };
    if (kind === 'docx' && magic !== 'zip') {
      // 有人会把 .doc 直接改名成 .docx，这里按魔数识别后同样给出友好提示
      if (magic === 'ole') return { ok: false, err: '这是旧版 .doc 改了后缀（OLE2 格式），请先用 Word 另存为 .docx 再导入' };
      return { ok: false, err: '文件头不是 ZIP（PK），不是有效的 docx' };
    }
    if (kind === 'img') {
      if (magic !== 'jpg' && magic !== 'png' && magic !== 'gif') return { ok: false, err: '文件头不是有效图片签名（jpg/png/gif）' };
    }
    return { ok: true, kind: kind, ext: ext, magic: magic };
  }

  /* ---------------- 文本提取 ---------------- */
  async function extractPdf(f, onProgress) {
    var pdfjs = await getPdfjs();
    var doc = await pdfjs.getDocument({ data: await f.file.arrayBuffer() }).promise;
    f.pageCount = doc.numPages;
    var tess = null, blocks = [], ocrPages = 0, failed = [];
    try {
      for (var p = 1; p <= doc.numPages; p++) {
        if (f.cancelled) throw new Error('已取消');
        onProgress((p - 1) / doc.numPages, '解析第 ' + p + '/' + doc.numPages + ' 页');
        var page = await doc.getPage(p);
        var tc = await page.getTextContent();
        var text = tc.items.map(function (it) {
          return it.str + (it.hasEOL ? '\n' : ' ');
        }).join('').replace(/[ \t]{2,}/g, ' ').trim();

        if (text.replace(/\s/g, '').length < OCR_TRIGGER) {
          // 文本层太少 → 扫描页，走 OCR
          if (ocrPages >= OCR_PAGE_LIMIT) {
            failed.push(p);
            log('[' + f.name + '] 第 ' + p + ' 页为扫描页，已达 OCR 上限 ' + OCR_PAGE_LIMIT + ' 页，跳过');
            continue;
          }
          onProgress((p - 0.5) / doc.numPages, '第 ' + p + ' 页 OCR 识别中');
          if (!tess) {
            tess = await getTesseract();
            f.worker = await tess.createWorker(['chi_sim', 'eng'], 1, {
              logger: function (m) {
                if (m && typeof m.progress === 'number') {
                  onProgress((p - 0.5 + 0.5 * m.progress) / doc.numPages, '第 ' + p + ' 页 OCR ' + Math.round(m.progress * 100) + '%');
                }
              }
            });
          }
          var scale = Math.min(2, OCR_DPI / 72);
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          var r = await f.worker.recognize(canvas);
          var ocrText = String((r && r.data && r.data.text) || '').trim();
          page.cleanup();
          if (ocrText) {
            blocks.push({ fileId: f.id, pageFrom: p, pageTo: p, text: ocrText, isOcr: true });
            ocrPages++;
          } else {
            failed.push(p);
          }
          onProgress(p / doc.numPages, '第 ' + p + ' 页 OCR 完成');
        } else {
          blocks.push({ fileId: f.id, pageFrom: p, pageTo: p, text: text, isOcr: false });
          page.cleanup();
        }
      }
    } finally {
      if (f.worker) { try { await f.worker.terminate(); } catch (e) {} f.worker = null; }
      try { await doc.destroy(); } catch (e) {}
    }
    f.ocrPages = ocrPages;
    f.failedPages = failed;
    return blocks;
  }

  async function extractDocx(f, onProgress) {
    onProgress(0.2, '解析 docx 文档结构');
    var mammoth = await getMammoth();
    var ab = await f.file.arrayBuffer();
    var out = await mammoth.convertToMarkdown({ arrayBuffer: ab });
    var md = String(out.value || '');
    if (!md.trim()) throw new Error('docx 解析结果为空（可能是图片型文档，请转为 PDF 后导入）');
    onProgress(0.7, '重组段落分节');
    // docx 无物理页码，按空行分段、约 3000 字符一组作为「节」，页码以 §N 展示
    var paras = md.split(/\n{2,}/), blocks = [], buf = [], sec = 0;
    paras.forEach(function (p) {
      var t = p.trim();
      if (!t) return;
      buf.push(t);
      if (buf.join('\n\n').length >= 3000) {
        sec++;
        blocks.push({ fileId: f.id, pageFrom: sec, pageTo: sec, text: buf.join('\n\n'), isOcr: false });
        buf = [];
      }
    });
    if (buf.length) {
      sec++;
      blocks.push({ fileId: f.id, pageFrom: sec, pageTo: sec, text: buf.join('\n\n'), isOcr: false });
    }
    f.pageCount = sec;
    f.ocrPages = 0;
    f.failedPages = [];
    onProgress(1, 'docx 解析完成');
    return blocks;
  }

  async function extractImages(f, onProgress) {
    var tess = await getTesseract();
    onProgress(0.1, '加载 OCR 引擎（中文+英文）');
    f.worker = await tess.createWorker(['chi_sim', 'eng'], 1, {
      logger: function (m) {
        if (m && typeof m.progress === 'number') onProgress(0.1 + 0.85 * m.progress, 'OCR ' + Math.round(m.progress * 100) + '%');
      }
    });
    var r = await f.worker.recognize(f.file);
    var text = String((r && r.data && r.data.text) || '').trim();
    try { await f.worker.terminate(); } catch (e) {}
    f.worker = null;
    if (!text) throw new Error('OCR 未识别到文字（图片可能不清晰或不含文字）');
    f.pageCount = 1;
    f.ocrPages = 1;
    f.failedPages = [];
    onProgress(1, 'OCR 完成');
    return [{ fileId: f.id, pageFrom: 1, pageTo: 1, text: text, isOcr: true }];
  }

  /* ---------------- 分块器 ---------------- */
  function cleanText(t) {
    return String(t || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  /** 超长文本按段落/硬切拆成 ≤CHUNK_SIZE 的块 */
  function pushSplit(out, fileId, pageFrom, pageTo, text, isOcr) {
    var rest = text;
    while (rest.length > CHUNK_SIZE) {
      var cut = rest.lastIndexOf('\n', CHUNK_SIZE);
      if (cut < CHUNK_SIZE * 0.5) cut = CHUNK_SIZE;
      out.push({ fileId: fileId, pageFrom: pageFrom, pageTo: pageTo, text: rest.slice(0, cut), isOcr: !!isOcr });
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push({ fileId: fileId, pageFrom: pageFrom, pageTo: pageTo, text: rest, isOcr: !!isOcr });
  }
  /** 相邻同源页的短文本合并，减少块数、节省 token */
  function buildChunks(blocks, fileId) {
    var out = [];
    blocks.forEach(function (b) {
      var t = cleanText(b.text);
      if (!t) return;
      var last = out[out.length - 1];
      if (last && !last.isOcr && !b.isOcr && last.pageTo === b.pageFrom - 1 &&
          last.text.length + t.length + 1 <= CHUNK_SIZE) {
        last.text += '\n' + t;
        last.pageTo = b.pageTo;
        return;
      }
      pushSplit(out, fileId, b.pageFrom, b.pageTo, t, b.isOcr);
    });
    return out;
  }

  /* ---------------- 队列 ---------------- */

return { loadScript, validateFile, extractPdf, extractDocx, extractImages, buildChunks };
};
