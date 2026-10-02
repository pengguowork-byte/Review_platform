(function () {
  'use strict';
  var prompt, requestedUpdate = false;
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); prompt = event; document.getElementById('pwaInstall').hidden = false; });
  document.getElementById('pwaInstall').addEventListener('click', async function () {
    if (!prompt) return; await prompt.prompt(); await prompt.userChoice; prompt = null; document.getElementById('pwaInstall').hidden = true;
  });
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').then(function (registration) {
      function notify() { if (registration.waiting) document.getElementById('pwaUpdate').hidden = false; }
      notify(); registration.addEventListener('updatefound', function () { var worker = registration.installing; if (worker) worker.addEventListener('statechange', notify); });
      navigator.serviceWorker.addEventListener('controllerchange', function () { if (requestedUpdate) location.reload(); });
      document.getElementById('pwaUpdate').onclick=function(){window.KnowledgePwaRefresh();};
      window.KnowledgePwaRefresh = function () { if (registration.waiting) { requestedUpdate = true; registration.waiting.postMessage('activate'); } else location.reload(); };
    }).catch(function () { /* Local review remains available if caching fails. */ });
  }
})();
