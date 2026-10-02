'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const bank = JSON.parse(fs.readFileSync(path.join(root, 'data/library.json'), 'utf8'));
bank.subjects = bank.subjects.map(s => s.source ? { ...s, ...JSON.parse(fs.readFileSync(path.join(root, s.source), 'utf8')) } : s);
const ids = new Set();
let count = 0;
for (const s of bank.subjects) {
  if (!bank.categories.some(c => c.id === s.categoryId)) throw new Error('Invalid category for ' + s.id);
  for (const m of s.contentHtml.matchAll(/class="q" id="([^"]+)"/g)) {
    if (ids.has(m[1])) throw new Error('Duplicate card ' + m[1]);
    ids.add(m[1]); count++;
  }
}
fs.mkdirSync(path.join(root, 'assets/data'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets/data/library.js'), 'window.KNOWLEDGE_LIBRARY = ' + JSON.stringify(bank) + ';\n');
// Keep the old entry URL and therefore the same storage origin.
fs.copyFileSync(path.join(root, 'index.html'), path.join(root, '嵌入式校招八股_总览.html'));
console.log('Built ' + bank.subjects.length + ' subjects / ' + count + ' cards.');
