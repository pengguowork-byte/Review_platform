(function () {
  'use strict';
  var base = window.KNOWLEDGE_LIBRARY;
  var CUSTOM_KEY = 'knowledge-library-v1';
  var PREF_KEY = 'knowledge-library-preferences-v1';
  var prefs = window.LibraryPreferences.normalize({});
  var hadPreferences = false;
  try { var storedPreferences = localStorage.getItem(PREF_KEY); hadPreferences = !!storedPreferences; if (storedPreferences) prefs = window.LibraryPreferences.normalize(JSON.parse(storedPreferences)); } catch (e) {}
  var selectedCategory = '', selectedSubject = '';
  function element(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function validate(input) {
    if (!input || input.version !== 1 || !Array.isArray(input.categories) || !Array.isArray(input.subjects)) throw new Error('题库需包含 version:1、categories 和 subjects 数组');
    if (input.categories.length > 100 || input.subjects.length > 100) throw new Error('单次导入最多 100 个类型或专题');
    var categories = [], subjects = [], ids = new Set();
    input.categories.forEach(function (c) {
      if (!c || !/^[a-z][a-z0-9-]{0,63}$/.test(c.id) || typeof c.name !== 'string' || !c.name.trim() || ids.has(c.id)) throw new Error('知识类型 ID 或名称无效 / 重复');
      ids.add(c.id); categories.push({ id: c.id, name: c.name.trim().slice(0, 60) });
    });
    var categoryIds = new Set(base.categories.concat(prefs.categories, categories).map(function (c) { return c.id; }));
    ids = new Set(); var count = 0;
    input.subjects.forEach(function (s) {
      if (!s || !/^[a-z][a-z0-9-]{0,63}$/.test(s.id) || ids.has(s.id) || base.subjects.some(function (b) { return b.id === s.id; })) throw new Error('专题 ID 无效 / 重复 / 与内置专题冲突');
      if (typeof s.name !== 'string' || !s.name.trim() || !categoryIds.has(s.categoryId) || !Array.isArray(s.questions) || !s.questions.length) throw new Error('专题需要名称、有效 categoryId 和非空 questions');
      ids.add(s.id); var qids = new Set();
      var questions = s.questions.map(function (q) {
        if (!q || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(q.id) || qids.has(q.id) || typeof q.question !== 'string' || !q.question.trim() || typeof q.answer !== 'string' || !q.answer.trim()) throw new Error('题目需要唯一 ID、非空 question 和 answer');
        qids.add(q.id); count++;
        return { id: q.id, question: q.question.slice(0, 2000), answer: q.answer.slice(0, 20000), gist: String(q.gist || '').slice(0, 2000) };
      });
      subjects.push({ id: s.id, name: s.name.trim().slice(0, 60), categoryId: s.categoryId, questions: questions });
    });
    if (!subjects.length || count > 2000) throw new Error('题库需有题目，单次最多 2000 道');
    return { version: 1, categories: categories, subjects: subjects };
  }
  var custom = { version: 1, categories: [], subjects: [] };
  try { var saved = localStorage.getItem(CUSTOM_KEY); if (saved) custom = validate(JSON.parse(saved)); }
  catch (e) { document.getElementById('libraryStatus').textContent = '自定义题库读取失败：' + e.message; }
  var categories = base.categories.slice();
  custom.categories.forEach(function (c) { if (!categories.some(function (x) { return x.id === c.id; })) categories.push(c); });
  prefs.categories.forEach(function (c) { if (!categories.some(function (x) { return x.id === c.id; })) categories.push(c); });
  categories.forEach(function (c) { if (typeof prefs.names[c.id] === 'string' && prefs.names[c.id].trim()) c.name = prefs.names[c.id]; });
  prefs.recent = prefs.recent.filter(function (id) { return categories.some(function (c) { return c.id === id; }); });
  var subjects = base.subjects.concat(custom.subjects);
  var initialSubject = subjects.find(function (s) { return location.hash === '#' + s.id; });
  if (initialSubject) selectedSubject = initialSubject.id;
  var main = document.querySelector('main'), aside = document.querySelector('aside');
  subjects.forEach(function (subject) {
    var fragment = document.createDocumentFragment(), nav = document.createDocumentFragment();
    if (subject.contentHtml) {
      var template = document.createElement('template'); template.innerHTML = subject.contentHtml;
      fragment.appendChild(template.content);
      template = document.createElement('template'); template.innerHTML = subject.navigationHtml; nav.appendChild(template.content);
    } else {
      var heading = element('div', 'chapter-title', subject.name); heading.id = 'custom-' + subject.id; fragment.appendChild(heading);
      var chapter = element('a', 'chap', subject.name); chapter.href = '#' + heading.id; nav.appendChild(chapter);
      nav.appendChild(element('div', 'sec', '全部题目'));
      var list = element('ul'); nav.appendChild(list);
      subject.questions.forEach(function (q, i) {
        var card = element('div', 'q'); card.id = 'custom-' + subject.id + '-' + q.id;
        var head = element('div', 'q-head'); head.appendChild(element('span', 'q-idx', String(i + 1))); head.appendChild(element('span', 'q-title', q.question));
        var content = element('div', 'q-body');
        if (q.gist) { var gist = element('div', 'gist'); gist.appendChild(element('span', 'lbl', '一句话')); gist.appendChild(document.createTextNode(q.gist)); content.appendChild(gist); }
        var details = element('details'); details.id = card.id + '-answer'; details.appendChild(element('summary', '', '展开参考答案')); details.appendChild(element('div', 'plain-answer', q.answer)); content.appendChild(details);
        head.addEventListener('click', function (e) { if (!e.target.closest('button,.q-lvl,.quiz-wrap')) details.open = !details.open; });
        card.appendChild(head); card.appendChild(content); fragment.appendChild(card);
        var li = element('li'), link = element('a', '', (i + 1) + '. ' + q.question); link.href = '#' + card.id; li.appendChild(link); list.appendChild(li);
      });
    }
    Array.from(fragment.children).forEach(function (el) { el.dataset.subject = subject.id; el.dataset.category = subject.categoryId; });
    Array.from(nav.children).forEach(function (el) { el.dataset.subject = subject.id; el.dataset.category = subject.categoryId; });
    main.appendChild(fragment); aside.appendChild(nav);
  });
  var empty = element('div', 'library-empty', '此知识模块还没有题目。点击“添加知识”加入你的学习资料。'); empty.id = 'libraryEmpty'; main.appendChild(empty);
  function matches(card) { return (!selectedCategory || card.dataset.category === selectedCategory) && (!selectedSubject || card.dataset.subject === selectedSubject); }
  function updateSubjects() {
    var select = document.getElementById('subjectSelect'); select.replaceChildren(new Option('全部专题', ''));
    subjects.filter(function (s) { return !selectedCategory || s.categoryId === selectedCategory; }).forEach(function (s) { select.add(new Option(s.name, s.id)); });
    select.value = selectedSubject;
  }
  var tabs = document.getElementById('categoryTabs');
  function savePreferences() { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }
  function remember(id) {
    if (!id || !categories.some(function (c) { return c.id === id; })) return;
    window.LibraryPreferences.touch(prefs, id);
    try { savePreferences(); } catch (e) { document.getElementById('moduleStatus').textContent = '偏好保存失败：' + e.message; }
    renderRecent();
  }
  function chooseCategory(id) {
    selectedCategory = id; selectedSubject = ''; updateSubjects();
    if (id) remember(id); else renderRecent();
    document.dispatchEvent(new CustomEvent('knowledge-filter-change'));
  }
  function renderRecent() {
    tabs.replaceChildren();
    [{ id: '', name: '全部知识' }].concat(prefs.recent.map(function (id) { return categories.find(function (c) { return c.id === id; }); })).forEach(function (category) {
      var button = element('button', 'category-tab', category.name); button.type = 'button'; button.dataset.category = category.id;
      button.setAttribute('aria-pressed', String(category.id === selectedCategory));
      button.addEventListener('click', function () { chooseCategory(category.id); }); tabs.appendChild(button);
    });
    if (!prefs.recent.length) tabs.appendChild(element('span', 'recent-hint', '最近使用的模块会显示在这里'));
  }
  // First upgrade: infer actual past use from existing card histories.
  if (!hadPreferences) {
    try {
      var progress = JSON.parse(localStorage.getItem('eb-review-system-v1') || '{"cards":{}}');
      var lastUse = {};
      Object.keys(progress.cards || {}).forEach(function (id) {
        var card = document.getElementById(id); if (!card) return;
        (progress.cards[id].history || []).forEach(function (event) { if (Number.isFinite(event.ts)) lastUse[card.dataset.category] = Math.max(lastUse[card.dataset.category] || 0, event.ts); });
      });
      prefs.recent = Object.keys(lastUse).sort(function (a,b) { return lastUse[b] - lastUse[a]; }).slice(0,5);
    } catch (e) {}
  }
  if (initialSubject) remember(initialSubject.categoryId);
  renderRecent();
  document.getElementById('subjectSelect').addEventListener('change', function (e) {
    selectedSubject = e.target.value;
    var subject = subjects.find(function (s) { return s.id === selectedSubject; });
    if (subject) remember(subject.categoryId);
    document.dispatchEvent(new CustomEvent('knowledge-filter-change'));
  });
  document.addEventListener('click', function (e) {
    var card = e.target.closest('main .q');
    var link = e.target.closest('aside a[href^="#"]');
    if (card) remember(card.dataset.category);
    else if (link) remember(link.dataset.category || link.closest('[data-category]').dataset.category);
  });
  updateSubjects();
  function renderSummary() { document.getElementById('librarySummary').textContent = categories.length + ' 个知识模块 · ' + subjects.length + ' 个专题 · ' + main.querySelectorAll('.q').length + ' 道题。'; }
  renderSummary();
  window.KnowledgeLibrary = { matches: matches, categories: categories, subjects: subjects, validate: validate, importText: importLibrary, getCategory: function () { return selectedCategory; } };
  function importLibrary(text, targetCategory) {
    var incoming = validate(JSON.parse(text.replace(/^\uFEFF/, '')));
    if (targetCategory) {
      var target = categories.find(function (c) { return c.id === targetCategory; });
      if (!target) throw new Error('所选知识模块不存在');
      incoming.subjects.forEach(function (s) { s.categoryId = target.id; });
      if (!incoming.categories.some(function (c) { return c.id === target.id; })) incoming.categories.push({ id:target.id, name:target.name });
    }
    var combined = { version: 1, categories: custom.categories.slice(), subjects: custom.subjects.slice() };
    incoming.categories.forEach(function (c) { var i = combined.categories.findIndex(function (x) { return x.id === c.id; }); if (i >= 0) combined.categories[i] = c; else combined.categories.push(c); });
    incoming.subjects.forEach(function (s) { var i = combined.subjects.findIndex(function (x) { return x.id === s.id; }); if (i >= 0) combined.subjects[i] = s; else combined.subjects.push(s); });
    validate(combined); localStorage.setItem(CUSTOM_KEY, JSON.stringify(combined));
    incoming.subjects.slice().reverse().forEach(function (s) { remember(s.categoryId); });
    location.reload();
  }
  var modulesDialog = document.getElementById('modulesDialog'), editingId = null;
  var nameForm = document.getElementById('moduleNameForm'), nameInput = document.getElementById('moduleNameInput');
  function editName(id) {
    editingId = id; nameForm.hidden = false;
    document.getElementById('moduleNameLabel').textContent = id ? '重命名模块' : '新模块名称';
    nameInput.value = id ? categories.find(function (c) { return c.id === id; }).name : '';
    document.getElementById('moduleCreateBtn').hidden = true; nameInput.focus();
  }
  function closeNameForm() { nameForm.hidden = true; document.getElementById('moduleCreateBtn').hidden = false; }
  function renderModules() {
    var list = document.getElementById('moduleList'); list.replaceChildren();
    categories.forEach(function (category) {
      var row = element('div', 'module-row');
      var choose = element('button', 'module-choice', category.name); choose.type = 'button'; choose.dataset.module = category.id;
      choose.addEventListener('click', function () { chooseCategory(category.id); modulesDialog.close(); });
      var rename = element('button', 'module-rename', '重命名'); rename.type = 'button'; rename.setAttribute('aria-label', '重命名' + category.name);
      rename.addEventListener('click', function () { editName(category.id); });
      row.appendChild(choose); row.appendChild(rename); list.appendChild(row);
    });
  }
  document.getElementById('manageModulesBtn').addEventListener('click', function () { closeNameForm(); renderModules(); document.getElementById('moduleStatus').textContent = ''; modulesDialog.showModal(); });
  document.getElementById('modulesClose').addEventListener('click', function () { modulesDialog.close(); });
  modulesDialog.addEventListener('close', function () { document.getElementById('manageModulesBtn').focus(); });
  document.getElementById('moduleCreateBtn').addEventListener('click', function () { editName(null); });
  document.getElementById('moduleNameCancel').addEventListener('click', closeNameForm);
  nameForm.addEventListener('submit', function (e) {
    e.preventDefault();
    try {
      var name = window.LibraryPreferences.name(nameInput.value);
      if (categories.some(function (c) { return c.id !== editingId && c.name === name; })) throw new Error('已有同名模块，请换一个名称');
      var next = window.LibraryPreferences.normalize(JSON.parse(JSON.stringify(prefs)));
      var id = editingId || 'module-' + Date.now().toString(36);
      if (editingId) next.names[id] = name;
      else next.categories.push({ id:id, name:name });
      localStorage.setItem(PREF_KEY, JSON.stringify(next)); prefs = next;
      if (editingId) categories.find(function (c) { return c.id === id; }).name = name;
      else categories.push({ id:id, name:name });
      closeNameForm(); renderModules(); renderRecent(); renderSummary();
      document.dispatchEvent(new CustomEvent('knowledge-names-change'));
      document.getElementById('moduleStatus').textContent = editingId ? '模块名称已保存，题目和进度不变。' : '模块已创建，可通过“添加知识”导入题库。';
      if (!editingId) { chooseCategory(id); modulesDialog.close(); }
    } catch (e) { document.getElementById('moduleStatus').textContent = e.message; }
  });
})();
