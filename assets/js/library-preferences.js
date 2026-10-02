(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LibraryPreferences = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalize(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      lastUsed: Object.fromEntries(Object.entries(value.lastUsed||{}).filter(function(p){return /^[a-z][a-z0-9-]{0,63}$/.test(p[0])&&Number.isFinite(p[1])&&p[1]>=0;})),
      strategies: Object.fromEntries(Object.entries(value.strategies||{}).filter(function(p){return /^[a-z][a-z0-9-]{0,63}$/.test(p[0])&&['default','language','concept','practice'].indexOf(p[1])>=0;})),
      recent: Array.from(new Set(Array.isArray(value.recent) ? value.recent.filter(function (id) { return typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id); }) : [])).slice(0, 5),
      names: value.names && typeof value.names === 'object' && !Array.isArray(value.names) ? value.names : {},
      categories: Array.isArray(value.categories) ? value.categories.filter(function (c) { return c && /^[a-z][a-z0-9-]{0,63}$/.test(c.id) && typeof c.name === 'string' && c.name.trim(); }).map(function (c) { return { id:c.id, name:c.name.trim().slice(0,60) }; }) : []
    };
  }
  function touch(state, id, timestamp) { state.lastUsed=state.lastUsed||{};state.lastUsed[id]=timestamp==null?Date.now():timestamp; state.recent = [id].concat(state.recent.filter(function (old) { return old !== id; })).slice(0, 5); }
  function name(value) {
    var text = String(value || '').trim();
    if (!text || text.length > 60) throw new Error('模块名称需为 1–60 个字符');
    return text;
  }
  return { normalize:normalize, touch:touch, name:name };
});
