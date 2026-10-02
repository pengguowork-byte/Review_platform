(function () {
  'use strict';
  var account = localStorage.getItem('knowledge-cloud-account') || '';
  var keys = ['knowledge-library-v1', 'eb-review-system-v1', 'knowledge-library-preferences-v1'];
  function scoped(key) { return account ? 'knowledge-user:' + account + ':' + key : key; }
  window.KnowledgeStorage = {
    account: account, keys: keys,
    getItem: function (key) { return localStorage.getItem(scoped(key)); },
    setItem: function (key, value) {
      // An account switch in another tab must never save old UI data into a new account.
      if ((localStorage.getItem('knowledge-cloud-account') || '') !== account) throw new Error('账号已变化，请刷新页面');
      if (window.KnowledgeStorage.blockWrites) throw new Error('另一窗口已修改数据，请先刷新页面');
      if (window.KnowledgeStorage.requireRefresh && key !== 'eb-review-system-v1') throw new Error('已收到新的题库或模块配置，请先点击“刷新应用更新”');
      localStorage.setItem(scoped(key), value);
      document.dispatchEvent(new CustomEvent('knowledge-local-change', { detail: key }));
    },
    writeRemote: function (key, value) { localStorage.setItem(scoped(key), value); },
    removeRemote: function (key) { localStorage.removeItem(scoped(key)); },
    batch: function (values) {
      if ((localStorage.getItem('knowledge-cloud-account')||'') !== account || window.KnowledgeStorage.blockWrites || window.KnowledgeStorage.requireRefresh) throw new Error('数据已更新，请先刷新');
      var old={}; Object.keys(values).forEach(function(key){old[key]=localStorage.getItem(scoped(key));});
      try { Object.keys(values).forEach(function(key){localStorage.setItem(scoped(key),values[key]);}); }
      catch(e){Object.keys(old).forEach(function(key){if(old[key]===null)localStorage.removeItem(scoped(key));else localStorage.setItem(scoped(key),old[key]);});throw e;}
      document.dispatchEvent(new CustomEvent('knowledge-local-change'));
    },
    metaKey: function (suffix) { return 'knowledge-user:' + account + ':cloud-' + suffix; }
  };
  window.addEventListener('storage', function (event) {
    if (event.key === 'knowledge-cloud-account') location.reload();
    else if (keys.some(function (key) { return event.key === scoped(key); })) document.dispatchEvent(new CustomEvent('knowledge-other-tab-change'));
  });
})();
