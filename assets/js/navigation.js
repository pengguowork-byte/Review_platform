
(function () {
  // 分节折叠：点击 .sec 切换其后的问题列表
  document.querySelectorAll('aside .sec').forEach(function (sec) {
    sec.addEventListener('click', function () {
      var ul = sec.nextElementSibling;
      if (ul && ul.tagName === 'UL') {
        var hidden = ul.style.display === 'none';
        ul.style.display = hidden ? '' : 'none';
        sec.classList.toggle('collapsed', !hidden);
      }
    });
  });
  // 章节折叠：点击 .chap 切换整章（其后所有分节 + 列表）
  document.querySelectorAll('aside .chap').forEach(function (chap) {
    chap.addEventListener('click', function (e) {
      e.preventDefault();
      var siblings = [];
      var sib = chap.nextElementSibling;
      while (sib && !sib.classList.contains('chap')) {
        siblings.push(sib);
        sib = sib.nextElementSibling;
      }
      var anyVisible = siblings.some(function (el) { return el.style.display !== 'none'; });
      siblings.forEach(function (el) { el.style.display = anyVisible ? 'none' : ''; });
      chap.classList.toggle('collapsed', anyVisible);
    });
  });
})();
