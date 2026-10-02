(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./review-engine.js'));
  else root.CloudModel = factory(root.ReviewEngine);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
  'use strict';
  function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function equal(a, b) { return stable(a) === stable(b); }
  function stable(v) {
    if (v === undefined) return 'undefined';
    if (v && typeof v === 'object' && !Array.isArray(v)) return '{' + Object.keys(v).sort().map(function (k) { safeKey(k); return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return JSON.stringify(v);
  }
  function safeKey(k) { if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('同步数据含不安全的字段'); return k; }
  function map(list) { var out = {}; (list || []).forEach(function (item) { out[safeKey(item.id)] = copy(item); }); return out; }
  function encode(snapshot) {
    snapshot = snapshot || {};
    var lib = snapshot.library || {}, prefs = snapshot.preferences || {};
    var subjects = map(lib.subjects);
    Object.keys(subjects).forEach(function (id) { subjects[id].questions = map(subjects[id].questions); });
    return { categories: map(lib.categories), subjects: subjects, names: copy(prefs.names || {}), modules: map(prefs.categories), recent: copy(prefs.recent || []), lastUsed:copy(prefs.lastUsed||{}), strategies:copy(prefs.strategies||{}), cards: copy((snapshot.progress || {}).cards || {}) };
  }
  function decode(value) {
    var subjects = Object.values(value.subjects || {}).map(function (s) { s = copy(s); s.questions = Object.values(s.questions || {}); return s; });
    return { version: 1, library: { version: 1, categories: Object.values(value.categories || {}), subjects: subjects }, preferences: { lastUsed:value.lastUsed||{}, strategies:value.strategies||{}, names: value.names || {}, categories: Object.values(value.modules || {}), recent: (value.recent || []).slice(0, 5) }, progress: { cards: value.cards || {} } };
  }
  // Three-way merge: independent edits combine; concurrent edits to one field require a choice.
  function merge(base, local, remote, choices) {
    var b = encode(base), l = encode(local), r = encode(remote), conflicts = [];
    function field(before, mine, theirs, path) {
      if (equal(mine, theirs)) return copy(mine);
      if (equal(mine, before)) return copy(theirs);
      if (equal(theirs, before)) return copy(mine);
      var objects = [before, mine, theirs].every(function (v) { return v === undefined || (v && typeof v === 'object' && !Array.isArray(v)); });
      // Deletion versus editing is a conflict, rather than silently resurrecting the record.
      if (objects && mine !== undefined && theirs !== undefined) {
        var out = {};
        Array.from(new Set(Object.keys(before || {}).concat(Object.keys(mine), Object.keys(theirs)))).forEach(function (key) {
          safeKey(key); var next = field((before || {})[key], mine[key], theirs[key], path + '/' + key);
          if (next !== undefined) out[key] = next;
        });
        return out;
      }
      var choice = choices && choices[path];
      if (!choice) conflicts.push({ path: path, local: copy(mine), remote: copy(theirs) });
      return copy(choice === 'remote' ? theirs : mine);
    }
    var out = {};
    ['categories', 'subjects', 'names', 'modules', 'strategies'].forEach(function (key) { out[key] = field(b[key], l[key], r[key], key); });
    // Recent modules are presentation preferences, unioned in local-first order.
    out.lastUsed={};Array.from(new Set(Object.keys(l.lastUsed).concat(Object.keys(r.lastUsed)))).forEach(function(id){safeKey(id);out.lastUsed[id]=Math.max(l.lastUsed[id]||0,r.lastUsed[id]||0);});
    out.recent=Array.from(new Set(l.recent.concat(r.recent,Object.keys(out.lastUsed)))).sort(function(a,b){var delta=(out.lastUsed[b]||0)-(out.lastUsed[a]||0);return delta||a.localeCompare(b);}).slice(0,5);
    out.cards = {};
    Array.from(new Set(Object.keys(l.cards).concat(Object.keys(r.cards)))).forEach(function (id) {
      safeKey(id);
      out.cards[id] = l.cards[id] && r.cards[id] ? engine.merge(l.cards[id], r.cards[id]) : copy(l.cards[id] || r.cards[id]);
    });
    return { snapshot: decode(out), conflicts: conflicts };
  }
  return { merge: merge, equal: equal, empty: function () { return decode({}); } };
});
