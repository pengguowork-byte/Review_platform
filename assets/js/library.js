(function () {
  'use strict';
  var base = window.KNOWLEDGE_LIBRARY;
  var CUSTOM_KEY = 'knowledge-library-v1';
  var PREF_KEY = 'knowledge-library-preferences-v1';
  var prefs = window.LibraryPreferences.normalize({});
  var hadPreferences = false;
  try { var storedPreferences = window.KnowledgeStorage.getItem(PREF_KEY); hadPreferences = !!storedPreferences; if (storedPreferences) prefs = window.LibraryPreferences.normalize(JSON.parse(storedPreferences)); } catch (e) {}
  var selectedCategory = '', selectedSubject = '';
  function element(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function validate(input) { return window.LibraryModel.validate(input, base, prefs); }
  var custom = { version: 1, categories: [], subjects: [] };
  try { var saved = window.KnowledgeStorage.getItem(CUSTOM_KEY); if (saved) custom = validate(JSON.parse(saved)); }
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
  function renderSubject(subject) {
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
        if(q.type==='选择题'||q.type==='填空题'){
          var form=element('form','local-question'),result=element('p');result.setAttribute('role','status');
          form.append(element('p','',q.type==='填空题'?'填写答案；按文字匹配，多个正确答案用 | 分隔。':'选择正确答案，再提交核对。'));
          if(q.type==='选择题'){(q.options||[]).forEach(function(option,index){var label=element('label'),input=element('input');input.type='radio';input.name='answer';input.value=String.fromCharCode(65+index);label.append(input,document.createTextNode(input.value+'. '+option.replace(/^[A-H][.、．)）]\s*/,'')));form.append(label);});}
          else{var input=element('input');input.name='answer';input.setAttribute('aria-label','填空作答 '+q.question);form.append(input);}
          var submit=element('button','sync-btn','提交作答'),retry=element('button','sync-btn','已回顾答案，重新练习');submit.type='submit';retry.type='button';retry.hidden=true;retry.onclick=function(){form.reset();details.open=false;submit.disabled=false;retry.hidden=true;result.textContent='';};form.append(submit,retry,result);
          form.addEventListener('submit',function(e){e.preventDefault();try{var correct=window.QuestionModel.grade(q,new FormData(form).get('answer'));result.textContent=correct?'回答正确，记为熟练；可继续复习巩固。':'回答有误，已记为忘记了，请回顾参考答案。';details.open=true;submit.disabled=true;retry.hidden=false;document.dispatchEvent(new CustomEvent('knowledge-local-verdict',{detail:{cid:card.id,correct:correct}}));}catch(err){result.textContent=err.message;}});content.append(form);
        }
        var details = element('details'); details.id = card.id + '-answer'; details.appendChild(element('summary', '', '展开参考答案')); details.appendChild(element('div', 'plain-answer', q.answer)); if(q.explanation)details.appendChild(element('div','plain-answer','解析：'+q.explanation));if(q.source)details.appendChild(element('p','source-reference','来源：'+q.source));content.appendChild(details);
        head.addEventListener('click', function (e) { if (!e.target.closest('button,.q-lvl,.quiz-wrap')) details.open = !details.open; });
        card.appendChild(head); card.appendChild(content); fragment.appendChild(card);
        var li = element('li'), link = element('a', '', (i + 1) + '. ' + q.question); link.href = '#' + card.id; li.appendChild(link); list.appendChild(li);
      });
    }
    Array.from(fragment.children).forEach(function (el) { el.dataset.subject = subject.id; el.dataset.category = subject.categoryId; });
    Array.from(nav.children).forEach(function (el) { el.dataset.subject = subject.id; el.dataset.category = subject.categoryId; });
    main.appendChild(fragment); aside.appendChild(nav);
  }
  subjects.forEach(renderSubject);
  var empty = element('div', 'library-empty', '此知识模块还没有题目。点击“添加知识”加入你的学习资料。'); empty.id = 'libraryEmpty'; main.appendChild(empty);
  function matches(card) { return (!selectedCategory || card.dataset.category === selectedCategory) && (!selectedSubject || card.dataset.subject === selectedSubject); }
  function updateSubjects() {
    var select = document.getElementById('subjectSelect'); select.replaceChildren(new Option('全部专题', ''));
    subjects.filter(function (s) { return !selectedCategory || s.categoryId === selectedCategory; }).forEach(function (s) { select.add(new Option(s.name, s.id)); });
    select.value = selectedSubject;
  }
  var tabs = document.getElementById('categoryTabs');
  function savePreferences() { window.KnowledgeStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }
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
      var progress = JSON.parse(window.KnowledgeStorage.getItem('eb-review-system-v1') || '{"cards":{}}');
      var lastUse = {};
      Object.keys(progress.cards || {}).forEach(function (id) {
        var card = document.getElementById(id); if (!card) return;
        (progress.cards[id].history || []).forEach(function (event) { if (Number.isFinite(event.ts)) lastUse[card.dataset.category] = Math.max(lastUse[card.dataset.category] || 0, event.ts); });
      });
      prefs.lastUsed=lastUse; prefs.recent = Object.keys(lastUse).sort(function (a,b) { return lastUse[b] - lastUse[a]; }).slice(0,5);
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
  window.KnowledgeLibrary = { matches: matches, categories: categories, subjects: subjects, validate: validate, importText: importLibrary, getStrategy:function(id){return prefs.strategies[id]||'default';}, getCategory: function () { return selectedCategory; }, getCustom:function(){return JSON.parse(window.KnowledgeStorage.getItem(CUSTOM_KEY)||'{"version":1,"categories":[],"subjects":[]}');}, saveCustom:saveCustom };
  window.KnowledgeLibrary.refresh=function(){
    var nextPrefs=window.LibraryPreferences.normalize(JSON.parse(window.KnowledgeStorage.getItem(PREF_KEY)||'{}'));
    var next=window.LibraryModel.validate(window.KnowledgeLibrary.getCustom(),base,nextPrefs);
    var oldSubjects=new Map(custom.subjects.map(function(s){return [s.id,JSON.stringify(s)];}));
    var nextSubjects=new Map(next.subjects.map(function(s){return [s.id,JSON.stringify(s)];}));
    Array.from(main.querySelectorAll('[data-subject]')).concat(Array.from(aside.querySelectorAll('[data-subject]'))).forEach(function(node){var id=node.dataset.subject;if(oldSubjects.has(id)&&oldSubjects.get(id)!==nextSubjects.get(id))node.remove();});
    next.subjects.forEach(function(subject){if(oldSubjects.get(subject.id)!==JSON.stringify(subject))renderSubject(subject);});
    custom=next;prefs=nextPrefs;subjects.splice.apply(subjects,[0,subjects.length].concat(base.subjects,custom.subjects));
    categories.splice.apply(categories,[0,categories.length].concat(base.categories.map(function(c){return Object.assign({},c);})));custom.categories.concat(prefs.categories).forEach(function(c){if(!categories.some(function(old){return old.id===c.id;}))categories.push(Object.assign({},c));});
    categories.forEach(function(c){if(prefs.names[c.id])c.name=prefs.names[c.id];});prefs.recent=prefs.recent.filter(function(id){return categories.some(function(c){return c.id===id;});});
    if(!subjects.some(function(s){return s.id===selectedSubject;}))selectedSubject='';if(!categories.some(function(c){return c.id===selectedCategory;}))selectedCategory='';
    updateSubjects();renderRecent();renderModules();renderSummary();document.dispatchEvent(new CustomEvent('knowledge-library-rendered'));document.dispatchEvent(new CustomEvent('knowledge-names-change'));document.dispatchEvent(new CustomEvent('knowledge-filter-change'));
  };
  function saveCustom(bank,resetIds){
    bank=validate(bank);var progress=JSON.parse(window.KnowledgeStorage.getItem('eb-review-system-v1')||'{"cards":{}}');
    var undo={library:window.KnowledgeLibrary.getCustom(),progress:progress};progress=JSON.parse(JSON.stringify(progress));
    (resetIds||[]).forEach(function(id){if(progress.cards[id])window.ReviewEngine.apply(progress.cards[id],null,null,null,true,Date.now(),{id:crypto.randomUUID(),fullHistory:!!window.KnowledgeStorage.account});});
    var writes={};writes[CUSTOM_KEY]=JSON.stringify(bank);writes['eb-review-system-v1']=JSON.stringify(progress);writes['knowledge-library-undo']=JSON.stringify(undo);window.KnowledgeStorage.batch(writes);
    location.reload();
  }
  function importLibrary(text, targetCategory) {
    var incoming = validate(JSON.parse(text.replace(/^\uFEFF/, '')));if(!incoming.subjects.length)throw new Error('导入题库需要至少一个非空专题');
    if (targetCategory) {
      var target = categories.find(function (c) { return c.id === targetCategory; });
      if (!target) throw new Error('所选知识模块不存在');
      incoming.subjects.forEach(function (s) { s.categoryId = target.id; });
      if (!incoming.categories.some(function (c) { return c.id === target.id; })) incoming.categories.push({ id:target.id, name:target.name });
    }
    document.dispatchEvent(new CustomEvent('knowledge-import-preview',{detail:incoming}));
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
      var strategy=element('select');strategy.setAttribute('aria-label','复习策略 '+category.name);[['default','通用复述'],['language','语言记忆：短间隔、回忆词义与例句'],['concept','概念理解：解释原理与关联'],['practice','推导应用：步骤、条件与练习']].forEach(function(v){strategy.add(new Option(v[1],v[0]));});strategy.value=prefs.strategies[category.id]||'default';strategy.addEventListener('change',function(){var next=window.LibraryPreferences.normalize(prefs);next.strategies=Object.assign({},next.strategies);next.strategies[category.id]=strategy.value;try{window.KnowledgeStorage.setItem(PREF_KEY,JSON.stringify(next));prefs=next;document.getElementById('moduleStatus').textContent='策略已保存，从下一次复习开始使用。';}catch(e){document.getElementById('moduleStatus').textContent=e.message;}});
      row.appendChild(choose);row.appendChild(strategy); row.appendChild(rename); list.appendChild(row);
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
      window.KnowledgeStorage.setItem(PREF_KEY, JSON.stringify(next)); prefs = next;
      if (editingId) categories.find(function (c) { return c.id === id; }).name = name;
      else categories.push({ id:id, name:name });
      closeNameForm(); renderModules(); renderRecent(); renderSummary();
      document.dispatchEvent(new CustomEvent('knowledge-names-change'));
      document.getElementById('moduleStatus').textContent = editingId ? '模块名称已保存，题目和进度不变。' : '模块已创建，可通过“添加知识”导入题库。';
      if (!editingId) { chooseCategory(id); modulesDialog.close(); }
    } catch (e) { document.getElementById('moduleStatus').textContent = e.message; }
  });
})();
