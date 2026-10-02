
(function () {
  var input = document.getElementById('qa-search');
  var count = document.getElementById('qa-count');
  var toggleBtn = document.getElementById('qa-toggle');
  var cards = Array.prototype.slice.call(document.querySelectorAll('main .q'));
  var expanded = false;

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // 高亮标题中的关键词（忽略 HTML 标签，只在文本节点上包 mark）
  function highlightTitle(titleEl, query) {
    if (!titleEl) return;
    titleEl.querySelectorAll('mark').forEach(function (m) {
      var p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
    if (!query) return;
    var re = new RegExp('(' + escapeReg(query) + ')', 'ig');
    var walker = document.createTreeWalker(titleEl, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var parent = node.parentNode;
      if (!parent || (parent.closest && parent.closest('mark'))) return;
      var text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0, m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mk = document.createElement('mark');
        mk.textContent = m[0];
        frag.appendChild(mk);
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      parent.replaceChild(frag, node);
    });
  }

  // 隐藏没有可见题目的分节 / 章节
  function hideEmptySections() {
    document.querySelectorAll('main h2').forEach(function (h2) {
      var visible = false, sib = h2.nextElementSibling;
      while (sib && sib.tagName !== 'H2' && !sib.classList.contains('chapter-title')) {
        if (sib.classList.contains('q') && sib.style.display !== 'none') { visible = true; break; }
        sib = sib.nextElementSibling;
      }
      h2.style.display = visible ? '' : 'none';
    });
    document.querySelectorAll('main .chapter-title').forEach(function (ch) {
      var visible = false, sib = ch.nextElementSibling;
      while (sib && !sib.classList.contains('chapter-title')) {
        if (sib.classList.contains('q') && sib.style.display !== 'none') { visible = true; break; }
        sib = sib.nextElementSibling;
      }
      ch.style.display = visible ? '' : 'none';
    });
  }

  function filter(q) {
    q = q.trim().toLowerCase();
    var visibleCount = 0, categoryCount = 0;
    cards.forEach(function (card) {
      var categoryHit = window.KnowledgeLibrary.matches(card);
      if (categoryHit) categoryCount++;
      var hit = categoryHit && (!q || card.textContent.toLowerCase().indexOf(q) >= 0);
      if (window.KnowledgeReview && window.KnowledgeReview.isActive()) hit = hit && window.KnowledgeReview.isDueCard(card.id);
      card.style.display = hit ? '' : 'none';
      if (hit) visibleCount++;
      highlightTitle(card.querySelector('.q-title'), hit && q ? q : '');
    });
    count.textContent = '显示 ' + visibleCount + ' / ' + categoryCount + ' 题';
    hideEmptySections();
    document.querySelectorAll('aside [data-subject]').forEach(function (el) {
      el.hidden = !window.KnowledgeLibrary.matches(el);
    });
    document.getElementById('libraryEmpty').style.display = categoryCount ? 'none' : 'block';
    if (window.KnowledgeReview) window.KnowledgeReview.updateView(visibleCount);
    return visibleCount;
  }

  window.KnowledgeView = { refresh: function () { return filter(input.value); } };
  document.addEventListener('knowledge-filter-change', window.KnowledgeView.refresh);
  input.addEventListener('input', function () { filter(input.value); });

  toggleBtn.addEventListener('click', function () {
    expanded = !expanded;
    cards.forEach(function (card) {
      if (card.style.display === 'none') return;
      var d = card.querySelector('details');
      if (d) d.open = expanded;
    });
    toggleBtn.textContent = expanded ? '全部折叠' : '全部展开';
  });
})();
