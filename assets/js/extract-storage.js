window.extractStorage = function (ctx) {
  var st = ctx.st;
  var DB_NAME = ctx.DB_NAME;
  var DB_VERSION = ctx.DB_VERSION;
  function idbOpen() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blocks')) db.createObjectStore('blocks', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('questions')) db.createObjectStore('questions', { keyPath: 'id' });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbAll(store) {
    return new Promise(function (res, rej) {
      var g = st.db.transaction(store, 'readonly').objectStore(store).getAll();
      g.onsuccess = function () { res(g.result || []); };
      g.onerror = function () { rej(g.error); };
    });
  }
  function idbPut(store, row) {
    return new Promise(function (res, rej) {
      var t = st.db.transaction(store, 'readwrite');
      t.objectStore(store).put(row);
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function idbPutAll(store, rows) {
    return new Promise(function (res, rej) {
      var t = st.db.transaction(store, 'readwrite');
      var os = t.objectStore(store);
      rows.forEach(function (r) { os.put(r); });
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function idbDelete(store, key) {
    return new Promise(function (res, rej) {
      var t = st.db.transaction(store, 'readwrite');
      t.objectStore(store).delete(key);
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function idbClearAll() {
    return Promise.all(['files', 'blocks', 'points', 'questions'].map(function (s) {
      return new Promise(function (res, rej) {
        var t = st.db.transaction(s, 'readwrite');
        t.objectStore(s).clear();
        t.oncomplete = function () { res(); };
        t.onerror = function () { rej(t.error); };
      });
    }));
  }

  /* ---------------- CDN 懒加载 ---------------- */

return { idbOpen, idbAll, idbPut, idbPutAll, idbDelete, idbClearAll };
};
