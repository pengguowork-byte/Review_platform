(function () {
  'use strict';
  var dialog = document.getElementById('addKnowledgeDialog');
  var status = document.getElementById('libraryStatus');
  var file = document.getElementById('libraryFile');
  var previousFocus;
  function select(mode) {
    document.querySelectorAll('[data-add-mode]').forEach(function (button) { button.setAttribute('aria-selected', String(button.dataset.addMode === mode)); });
    document.querySelectorAll('[data-add-panel]').forEach(function (panel) { panel.hidden = panel.dataset.addPanel !== mode; });
    dialog.querySelector('.add-category').hidden = mode === 'document';
    status.textContent = '';
  }
  document.getElementById('addKnowledgeBtn').addEventListener('click', function () {
    previousFocus = document.activeElement;
    var selectCategory = document.getElementById('addKnowledgeCategory');
    selectCategory.replaceChildren(new Option('沿用题库中的分类', ''));
    window.KnowledgeLibrary.categories.forEach(function (c) { selectCategory.add(new Option(c.name,c.id)); });
    selectCategory.value = window.KnowledgeLibrary.getCategory();
    select('file'); dialog.showModal();
  });
  document.querySelectorAll('[data-add-mode]').forEach(function (button) { button.addEventListener('click', function () { select(button.dataset.addMode); }); });
  document.getElementById('addKnowledgeClose').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('close', function () { if (previousFocus) previousFocus.focus(); });
  document.getElementById('libraryImportBtn').addEventListener('click', function () { file.click(); });
  function importText(text) {
    window.KnowledgeLibrary.importText(text, document.getElementById('addKnowledgeCategory').value);
  }
  file.addEventListener('change', async function () {
    try {
      if (!file.files[0]) return;
      if (file.files[0].size > 10 * 1024 * 1024) throw new Error('题库文件不能超过 10MB');
      importText(await file.files[0].text());
    } catch (e) { status.textContent = '导入失败：' + e.message; }
    finally { file.value = ''; }
  });
  document.getElementById('libraryPasteConfirm').addEventListener('click', function () {
    try { importText(document.getElementById('libraryPasteText').value); }
    catch (e) { status.textContent = '导入失败：' + e.message; }
  });
  document.getElementById('extractBtn').addEventListener('click', function () {
    dialog.close(); document.dispatchEvent(new CustomEvent('knowledge-open-extraction'));
  });
})();
