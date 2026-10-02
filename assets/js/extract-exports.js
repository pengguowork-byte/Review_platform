window.extractExports = function (ctx) {
  var st = ctx.st;
  var $ = ctx.$;
  var toast = ctx.toast;
  var fileNameOf = ctx.fileNameOf;
  var pageLabelOf = ctx.pageLabelOf;
  var loadScript = ctx.loadScript;
  var CDN = ctx.CDN;
  function tsName() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function download(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function visibleRows() {
    var kp = st.points.filter(function (p) { return !st.filterFile || p.fileId === st.filterFile; });
    var qs = st.questions.filter(function (q) { return !st.filterFile || q.fileId === st.filterFile; });
    return { kp: kp, qs: qs };
  }
  function kpExport(p) {
    return {
      知识类型: p.categoryId || '', 类型: p.type, 标题: p.title, 内容: p.content,
      来源文件: fileNameOf(p.fileId), 来源页: pageLabelOf(p) || '',
      置信度: p.confidence, 状态: p.status, 标签: (p.tags || []).join('、')
    };
  }
  function qExport(q) {
    return {
      知识类型: q.categoryId || '', 题型: q.type, 题干: q.question,
      选项: (q.options || []).join(' | '),
      答案: q.answer, 解析: q.explanation || '',
      来源文件: fileNameOf(q.fileId), 来源页: pageLabelOf(q) || '',
      置信度: q.confidence, 状态: q.status, 标签: (q.tags || []).join('、')
    };
  }
  function exportJson() {
    var v = visibleRows();
    var data = {
      app: 'eb-extract', version: 1, exportedAt: new Date().toISOString(),
      files: st.files.map(function (f) {
        return { name: f.name, size: f.size, kind: f.kind, pageCount: f.pageCount, ocrPages: f.ocrPages, textLength: f.textLength };
      }),
      points: v.kp.map(kpExport), questions: v.qs.map(qExport)
    };
    download('提取结果_' + tsName() + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    toast('已导出 JSON（' + v.kp.length + ' 知识点 / ' + v.qs.length + ' 题）', 'ok');
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportCsv() {
    var v = visibleRows();
    var head = ['类别', '类型/题型', '标题/题干', '内容/选项', '答案', '解析', '来源文件', '来源页', '置信度', '状态', '标签'];
    var lines = [head.join(',')];
    v.kp.forEach(function (p) {
      lines.push(['知识点', csvCell(p.type), csvCell(p.title), csvCell(p.content), '', '',
        csvCell(fileNameOf(p.fileId)), csvCell(pageLabelOf(p) || ''), p.confidence, csvCell(p.status), csvCell((p.tags || []).join('、'))].join(','));
    });
    v.qs.forEach(function (q) {
      lines.push(['题目', csvCell(q.type), csvCell(q.question), csvCell((q.options || []).join(' | ')), csvCell(q.answer), csvCell(q.explanation || ''),
        csvCell(fileNameOf(q.fileId)), csvCell(pageLabelOf(q) || ''), q.confidence, csvCell(q.status), csvCell((q.tags || []).join('、'))].join(','));
    });
    // 带 BOM，保证 Excel 直接打开中文不乱码
    download('提取结果_' + tsName() + '.csv', new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    toast('已导出 CSV（' + v.kp.length + ' 知识点 / ' + v.qs.length + ' 题）', 'ok');
  }
  async function exportXlsx() {
    var v = visibleRows();
    if (!v.kp.length && !v.qs.length) { toast('没有可导出的内容', 'bad'); return; }
    var btn = $('exExportXlsx');
    btn.disabled = true;
    btn.textContent = '加载表格库…';
    try {
      if (!st.lib.xlsx) {
        await loadScript(CDN.xlsx);
        st.lib.xlsx = window.XLSX;
      }
      if (!st.lib.xlsx) throw new Error('SheetJS 加载失败');
      var XLSX = st.lib.xlsx;
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.kp.map(kpExport)), '知识点');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.qs.map(qExport)), '题库');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(st.files.map(function (f) {
        return { 文件: f.name, 大小MB: +(f.size / 1048576).toFixed(2), 页数: f.pageCount, OCR页: f.ocrPages, 字符数: f.textLength, 状态: f.status };
      })), '文件清单');
      XLSX.writeFile(wb, '提取结果_' + tsName() + '.xlsx');
      toast('已导出 Excel（3 个 sheet）', 'ok');
    } catch (e) {
      toast('Excel 导出失败：' + e.message + '，已回退 CSV', 'bad');
      exportCsv();
    } finally {
      btn.disabled = false;
      btn.textContent = '导出 Excel';
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function exportLibrary() {
    var questions = visibleRows().qs.filter(function (q) { return q.status === '已确认'; });
    if (!questions.length) { toast('请先确认至少一道题，再导出复习题库', 'bad'); return; }
    var categories = window.KnowledgeLibrary.categories;
    var subjects = st.files.map(function (f) {
      var rows = questions.filter(function (q) { return q.fileId === f.id; });
      return {
        id: 'import-' + f.id.replace(/[^a-z0-9-]/g, '').slice(0, 50),
        name: f.name,
        categoryId: f.categoryId || categories[0].id,
        questions: rows.map(function (q) {
          return { id: q.id, question: q.question + (q.options && q.options.length ? '\n' + q.options.join('\n') : ''), answer: q.answer + (q.explanation ? '\n解析：' + q.explanation : '') };
        })
      };
    }).filter(function (s) { return s.questions.length; });
    var used = subjects.map(function (s) { return s.categoryId; });
    var library = { version: 1, categories: categories.filter(function (c) { return used.indexOf(c.id) >= 0; }), subjects: subjects };
    download('复习题库_' + tsName() + '.json', new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' }));
    toast('已导出复习题库，可通过主页“添加知识”加入学习', 'ok');
  }
return { exportJson, exportCsv, exportXlsx, exportLibrary };
};
