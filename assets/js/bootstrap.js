(function () {
  'use strict';
  if (window.KnowledgeView) window.KnowledgeView.refresh();
  // Diagrams are optional; the rest of the app works without the CDN.
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
  script.onload = function () {
    window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
    window.mermaid.run().catch(function (e) { console.warn('流程图渲染失败', e); });
  };
  script.onerror = function () { console.warn('流程图库未加载，保留图表源码'); };
  document.head.appendChild(script);
})();
