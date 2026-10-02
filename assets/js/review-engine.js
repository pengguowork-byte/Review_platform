(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReviewEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DAY = 86400000;
  var tracks = { skilled: [7, 15, 30, 60], mastered: [30, 60, 120] };
  var levels = ['forgotten', 'fuzzy', 'skilled', 'mastered'];
  function createCard() {
    return { level: null, reps: 0, interval: 0, ease: 2.5, due: 0, gate: 0, stage: 0, lapses: 0, quizzes: 0, restudy: false, history: [] };
  }
  function apply(card, level, coverage, accuracy, manual, timestamp) {
    if (level !== null && levels.indexOf(level) < 0) throw new Error('未知记忆等级');
    var now = timestamp == null ? Date.now() : timestamp;
    card.level = level;
    if (level === null) {
      card.reps = 0; card.interval = 0; card.due = 0; card.gate = 0; card.stage = 0; card.restudy = false;
      delete card.lastScore;
    } else {
      if (!manual) card.quizzes = (card.quizzes || 0) + 1;
      if (coverage != null) card.lastScore = coverage;
      if (level === 'mastered') card.ease = Math.min(3, card.ease + 0.1);
      else if (level === 'skilled') card.ease = Math.min(3, card.ease + 0.05);
      else if (level === 'fuzzy') card.ease = Math.max(1.3, card.ease - 0.1);
      else { card.ease = Math.max(1.3, card.ease - 0.2); card.lapses = (card.lapses || 0) + 1; }
      if (level === 'forgotten') {
        card.gate = 0; card.interval = 0; card.due = now; card.restudy = true; card.stage = 0;
      } else if (level === 'fuzzy') {
        card.gate = 0;
        card.interval = card.interval >= 7 ? 7 : Math.min(7, Math.max(1, Math.round((card.interval || 0) * 3)));
        card.restudy = false; card.due = now + card.interval * DAY;
      } else {
        // A graduated card that is now due must prove proficiency again.
        if (card.gate >= 2 && card.due && card.due <= now) card.gate = 0;
        card.gate = (card.gate || 0) + 1; card.restudy = false;
        if (card.gate >= 2) {
          card.stage = (card.stage || 0) + 1;
          card.interval = tracks[level][Math.min(card.stage - 1, tracks[level].length - 1)];
          card.due = now + card.interval * DAY;
        } else { card.interval = 1; card.due = now; }
      }
    }
    var event = { ts: now, result: manual ? 'manual-' + (level || 'unseen') : 'quiz', level: level, coverage: coverage == null ? null : coverage, accuracy: accuracy == null ? null : accuracy, interval: card.interval };
    // Keep a checkpoint before the retained history window for later merges.
    card.history.push(event);
    if (card.history.length > 60) {
      var dropped = card.history.shift();
      var checkpoint = card.checkpoint ? JSON.parse(JSON.stringify(card.checkpoint)) : createCard();
      checkpoint.history = [];
      apply(checkpoint, dropped.level, dropped.coverage, dropped.accuracy, String(dropped.result).indexOf('manual-') === 0, dropped.ts);
      checkpoint.history = []; delete checkpoint.checkpoint;
      card.checkpoint = checkpoint; card.checkpointAt = dropped.ts;
    }
    return card;
  }
  function key(e) { return e.ts + '|' + e.result + '|' + e.level; }
  function merge(left, right) {
    var seen = Object.create(null);
    (left.history || []).concat(right.history || []).forEach(function (event) {
      if (!event || !Number.isFinite(event.ts)) return;
      var e = JSON.parse(JSON.stringify(event));
      if (e.level === 'wrong') e.level = 'forgotten';
      if (e.level === 'unseen') e.level = null;
      if (e.level !== null && levels.indexOf(e.level) < 0) return;
      var k = key(e);
      // Stable conflict resolution independent of import direction.
      if (!seen[k] || JSON.stringify(e) < JSON.stringify(seen[k])) seen[k] = e;
    });
    var events = Object.keys(seen).map(function (k) { return seen[k]; }).sort(function (a, b) {
      return a.ts - b.ts || key(a).localeCompare(key(b));
    });
    if (!events.length) {
      var candidates = [left, right].sort(function (a, b) { return (b.due || 0) - (a.due || 0) || JSON.stringify(a).localeCompare(JSON.stringify(b)); });
      return JSON.parse(JSON.stringify(candidates[0]));
    }
    var checkpoints = [left, right].filter(function (c) { return c.checkpoint && Number.isFinite(c.checkpointAt); });
    // Only reuse a checkpoint preceding every retained event: later snapshots
    // could omit concurrent events from another device.
    checkpoints = checkpoints.filter(function (c) { return c.checkpointAt < events[0].ts; }).sort(function (a, b) {
      return b.checkpointAt - a.checkpointAt || JSON.stringify(a.checkpoint).localeCompare(JSON.stringify(b.checkpoint));
    });
    var out = checkpoints.length ? JSON.parse(JSON.stringify(checkpoints[0].checkpoint)) : createCard();
    out.history = [];
    if (checkpoints.length) { out.checkpoint = checkpoints[0].checkpoint; out.checkpointAt = checkpoints[0].checkpointAt; }
    events.forEach(function (e) { apply(out, e.level, e.coverage, e.accuracy, String(e.result || '').indexOf('manual-') === 0, e.ts); });
    return out;
  }
  return { createCard: createCard, apply: apply, merge: merge };
});
