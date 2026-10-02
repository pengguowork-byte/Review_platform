(function () {
  'use strict';
  var storage = window.KnowledgeStorage, model = window.CloudModel;
  var config = window.KNOWLEDGE_CLOUD_CONFIG || {}, client, session, busy = false, timer, stale = false;
  var pendingAction, choices = {}, conflicts = [];
  var $ = function (id) { return document.getElementById(id); };
  function status(text) { $('cloudStatus').textContent = text; $('cloudDetail').textContent = text; }
  function read(key, fallback, guest) { var raw = guest ? localStorage.getItem(key) : storage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  function snapshot(guest) {
    return { version: 1, library: read('knowledge-library-v1', { version:1, categories:[], subjects:[] }, guest), progress: read('eb-review-system-v1', { cards:{} }, guest), preferences: read('knowledge-library-preferences-v1', { names:{}, categories:[], recent:[] }, guest) };
  }
  function validate(data) {
    if (!data || data.version !== 1 || !data.library || !data.progress || !data.preferences) throw new Error('云端数据版本不兼容');
    if (new Blob([JSON.stringify(data)]).size > 8 * 1024 * 1024) throw new Error('同步数据超过 8 MB，请导出备份并清理题库');
    // The existing importer validates and renders custom content as plain text.
    var savedPrefs = window.LibraryPreferences.normalize(data.preferences);
    var library = data.library;
    if (!Array.isArray(library.categories) || !Array.isArray(library.subjects)) throw new Error('云端题库结构无效');
    // Include remotely created empty modules when validating references.
    var validationBank = JSON.parse(JSON.stringify(library));
    savedPrefs.categories.forEach(function (c) { if (!validationBank.categories.some(function (x) { return x.id === c.id; })) validationBank.categories.push(c); });
    if (library.subjects.length) window.KnowledgeLibrary.validate(validationBank);
    else if (validationBank.categories.length > 100 || validationBank.categories.some(function (c) { return !c || !/^[a-z][a-z0-9-]{0,63}$/.test(c.id) || typeof c.name !== 'string' || !c.name.trim(); })) throw new Error('云端模块无效');
    if (!data.progress.cards || typeof data.progress.cards !== 'object' || Array.isArray(data.progress.cards)) throw new Error('云端复习记录无效');
    Object.keys(data.progress.cards).forEach(function (id) {
      var c = data.progress.cards[id];
      if (!c || typeof c !== 'object' || !Array.isArray(c.history) || c.history.some(function (h) { return !h || !Number.isFinite(h.ts); })) throw new Error('云端复习历史无效');
    });
    // Model encoding also rejects prototype-pollution keys.
    model.merge(model.empty(), data, data);
    return data;
  }
  function apply(data) {
    validate(data);
    var before = snapshot();
    var pairs = [['knowledge-library-v1', data.library], ['knowledge-library-preferences-v1', data.preferences], ['eb-review-system-v1', data.progress]];
    var old = pairs.map(function (p) { return storage.getItem(p[0]); });
    try { pairs.forEach(function (p) { storage.writeRemote(p[0], JSON.stringify(p[1])); }); }
    catch (e) {
      pairs.forEach(function (p, i) { try { if (old[i] !== null) storage.writeRemote(p[0], old[i]); else storage.removeRemote(p[0]); } catch (_) {} });
      throw new Error('本地存储空间不足，同步未完成；请先导出备份');
    }
    document.dispatchEvent(new CustomEvent('knowledge-progress-replaced', { detail: JSON.parse(JSON.stringify(data.progress)) }));
    if (!model.equal(before.library, data.library) || !model.equal(before.preferences, data.preferences)) { if(!applyStructure()){ $('cloudReload').hidden = false; storage.requireRefresh = true; } }
  }
  function applyStructure(){if(document.querySelector('dialog[open]:not(#cloudDialog),.quiz-panel.open')||document.activeElement&&document.activeElement.matches('input,textarea,select'))return false;window.KnowledgeLibrary.refresh();storage.requireRefresh=false;$('cloudReload').hidden=true;return true;}
  function showConflicts(list, action) {
    conflicts = list; pendingAction = action; $('cloudConflicts').replaceChildren();
    list.forEach(function (item) {
      var row = document.createElement('div'); row.className = 'cloud-conflict';
      var title = document.createElement('strong'); title.textContent = item.path; row.appendChild(title);
      [['local','本机',item.local], ['remote','云端 / 待迁移',item.remote]].forEach(function (option) {
        var label = document.createElement('label'), radio = document.createElement('input');
        radio.type = 'radio'; radio.name = item.path; radio.value = option[0];
        radio.addEventListener('change', function () { choices[item.path] = option[0]; });
        label.appendChild(radio); label.appendChild(document.createTextNode(option[1] + '：' + (JSON.stringify(option[2]) || '删除').slice(0, 220))); row.appendChild(label);
      }); $('cloudConflicts').appendChild(row);
    });
    $('cloudResolve').hidden = false; status('存在 ' + list.length + ' 处冲突，请选择保留的内容；尚未覆盖数据');
    $('cloudDialog').showModal();
  }
  async function synchronize(resolved) {
    if (!client || !session || session.user.id !== storage.account || busy || stale || conflicts.length && !resolved) return;
    if (!navigator.onLine) { status('离线：数据已保存在本机，联网后同步'); return; }
    busy = true; status('正在同步…');
    var owner = session.user.id;
    function sameAccount() { if (!session || session.user.id !== owner || (localStorage.getItem('knowledge-cloud-account') || '') !== owner) throw new Error('登录账号已变化，请刷新页面'); }
    try {
      for (var attempt = 0; attempt < 4; attempt++) {
        var result = await client.from('review_sync').select('version,payload').eq('user_id', session.user.id).maybeSingle();
        if (result.error) throw result.error;
        sameAccount();
        var remote = result.data ? validate(result.data.payload) : model.empty();
        var version = result.data ? result.data.version : 0;
        var base = readMeta('baseline', model.empty()), local = snapshot();
        if (resolved) {
          var fresh = model.merge(base, local, remote).conflicts;
          if (fresh.some(function (item) { return !conflicts.some(function (old) { return old.path === item.path && model.equal(old.local, item.local) && model.equal(old.remote, item.remote); }); })) { choices = {}; resolved = false; }
        }
        var merged = model.merge(base, local, remote, resolved ? choices : {});
        if (merged.conflicts.length) { showConflicts(merged.conflicts, synchronize); return; }
        validate(merged.snapshot);
        if (!model.equal(remote, merged.snapshot)) {
          var write = await client.rpc('save_review_sync', { expected_version:version, new_payload:merged.snapshot });
          if (write.error) throw write.error;
          sameAccount();
          if (!write.data.accepted) continue; // Another device wrote first; pull and merge again.
        }
        // Preserve actions performed while the network request was in flight.
        var current = snapshot();
        if (!model.equal(current, local)) continue;
        apply(merged.snapshot);
        localStorage.setItem(storage.metaKey('baseline'), JSON.stringify(merged.snapshot));
        conflicts = []; choices = {}; $('cloudConflicts').replaceChildren(); $('cloudResolve').hidden = true;
        status('已同步 · '+new Date().toLocaleTimeString()+(storage.requireRefresh?' · 内容更新待应用，请关闭编辑或自测后应用更新':''));
        return;
      }
      throw new Error('其他设备正在频繁修改，请稍后重试');
    } catch (e) { status('同步失败，本机数据保留：' + (e.message || '请检查网络和配置')); }
    finally { busy = false; }
  }
  function readMeta(key, fallback) { var raw = localStorage.getItem(storage.metaKey(key)); return raw ? JSON.parse(raw) : fallback; }
  function schedule() { if(session)status(navigator.onLine?'本机更改已保存 · 等待同步':'离线：本机更改已保存，联网后同步');clearTimeout(timer); timer = setTimeout(function () { synchronize(); }, 1500); }
  function migrate(resolved) {
    try {
      if (!session || session.user.id !== storage.account) throw new Error('请先登录当前账号');
      if (stale) throw new Error('另一窗口已修改数据，请先刷新页面');
      var data = model.merge(model.empty(), snapshot(), snapshot(true), resolved ? choices : {});
      if (data.conflicts.length) { showConflicts(data.conflicts, migrate); return; }
      apply(data.snapshot); conflicts = []; choices = {}; $('cloudResolve').hidden = true;
      status('本机数据已复制到当前账号，等待同步');
      schedule();
    } catch (e) { status(e.message); }
  }
  $('cloudOpen').addEventListener('click', function () { $('cloudDialog').showModal(); });
  $('cloudClose').addEventListener('click', function () { $('cloudDialog').close(); });
  $('cloudReload').addEventListener('click', function () { if(stale){location.reload();return;}if(!applyStructure())status('请先完成或关闭编辑窗口和自测面板，再应用内容更新；当前作答已保留'); });
  $('cloudSyncNow').addEventListener('click', function () { synchronize(); });
  $('cloudMigrate').addEventListener('click', function () { migrate(); });
  $('cloudResolve').addEventListener('click', function () {
    if (conflicts.some(function (c) { return !choices[c.path]; })) { status('请为每处冲突选择保留的内容'); return; }
    pendingAction(true);
  });
  $('cloudLogin').addEventListener('submit', async function (event) {
    event.preventDefault(); var button = $('cloudLoginSubmit'); button.disabled = true;
    try {
      var result = await client.auth.signInWithPassword({ email:$('cloudEmail').value.trim(), password:$('cloudPassword').value });
      if (result.error) throw result.error;
      localStorage.setItem('knowledge-cloud-account', result.data.user.id); location.reload();
    } catch (e) { status('登录失败：' + e.message); }
    finally { $('cloudPassword').value = ''; button.disabled = false; }
  });
  $('cloudLogout').addEventListener('click', async function () {
    if (client) await client.auth.signOut({ scope:'local' });
    localStorage.removeItem('knowledge-cloud-account'); location.reload();
  });
  document.addEventListener('knowledge-local-change', schedule);
  document.addEventListener('knowledge-other-tab-change', function () {
    stale = true; storage.blockWrites = true; clearTimeout(timer); status('另一窗口修改了本机数据，请刷新后继续同步'); $('cloudReload').hidden = false;
  });
  window.addEventListener('online', schedule);
  window.addEventListener('offline', function () { status('离线：数据已保存在本机'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(); });
  async function init() {
    var anon = false;
    try { anon = JSON.parse(atob((config.publishableKey || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch (_) {}
    var enabled = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url || '') && ((config.publishableKey || '').startsWith('sb_publishable_') || anon);
    $('cloudLogin').hidden = true; $('cloudAccountActions').hidden = true;
    if (!enabled) { status('本地模式 · 云同步待配置'); $('cloudSetup').hidden = false; return; }
    $('cloudSetup').hidden = true;
    client = window.supabase.createClient(config.url, config.publishableKey, { auth:{ storageKey:'knowledge-supabase-session' }, global:{ fetch: function (url, options) { return fetch(url, Object.assign({}, options, { signal:AbortSignal.timeout(20000) })); } } });
    var result = await client.auth.getSession(); session = result.data.session;
    if (!session || session.user.id !== storage.account) {
      $('cloudLogin').hidden = false;
      if (storage.account) { $('cloudAccountActions').hidden = false; $('cloudSyncNow').disabled = true; $('cloudMigrate').disabled = true; }
      status(storage.account ? '登录已失效；本机账号数据保留，请重新登录或退出' : '本地模式 · 登录后开启同步');
      return;
    }
    $('cloudAccountActions').hidden = false; $('cloudUser').textContent = session.user.email;
    status('已登录 · 等待同步'); schedule();
    setInterval(function () { if (!document.hidden) synchronize(); }, 60000);
    client.auth.onAuthStateChange(function (event, next) {
      session = next;
      if (!next) { clearTimeout(timer); status('登录已失效，请重新登录；本机数据保留'); $('cloudLogin').hidden = false; }
    });
  }
  init().catch(function (e) { status('云同步初始化失败：' + e.message); });
})();
