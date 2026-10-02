'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
for (const [name, subject] of [['C++_八股.html','cpp'],['操作系统_八股.html','os'],['计算机网络_八股_样例.html','net'],['FreeRTOS_八股.html','rtos'],['STM32_八股.html','stm32'],['ROS_八股.html','ros']]) {
  const original = path.join(root, name), backup = path.join(root, 'archive', name);
  if (!fs.existsSync(backup)) fs.copyFileSync(original, backup);
  const url = 'index.html#' + subject;
  fs.writeFileSync(original, '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=' + url + '"><title>知识复习工作台</title></head><body><p>专题已合并到知识复习工作台。<a href="' + url + '">打开专题</a></p></body></html>\n');
}
for (const name of ['refactor.cjs', 'finalize.cjs', 'split-features.cjs']) {
  const source = path.join(root, 'scripts', name), target = path.join(root, 'archive', name);
  if (fs.existsSync(source)) fs.renameSync(source, target);
}
console.log('Archived original standalone pages and migration scripts.');
