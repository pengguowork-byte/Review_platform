'use strict';
const fs = require('fs');
const path = require('path');
module.exports = function createClient(ROOT) {
const UPSTREAM = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.AI_MODEL || 'deepseek-chat';
const TIMEOUT_MS = 60000;
/* ---------------- Key 读取 ---------------- */
/** 校验 Key 只含可见 ASCII：中文注释/全角字符一旦混进请求头，
 *  Node fetch 会抛 "Cannot convert argument to a ByteString…" 这种难懂错误，这里提前拦截并说人话 */
function checkKeyAscii(k, from) {
  if (/[^\x21-\x7e]/.test(k)) {
    throw new Error(from + ' 含有非 Key 内容（中文注释/全角字符/不可见字符）。'
      + 'HTTP 请求头只接受英文字符——该行请只保留 API Key 本身');
  }
  return k;
}
/** 环境变量 DEEPSEEK_API_KEY 优先；其次读同目录 deepseek.key 文件。
 *  文件解析容错（v2.0.2）：跳过空行与 # / ; 注释行（用户常直接由 deepseek.key.example 改名而来，
 *  第一行恰好是模板注释，旧逻辑会把注释文字当成 Key 塞进 Authorization 头），行内「Key 备注」只取第一段。 */
function loadKey() {
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim()) {
    return checkKeyAscii(process.env.DEEPSEEK_API_KEY.trim(), '环境变量 DEEPSEEK_API_KEY');
  }
  const p = path.join(ROOT, 'deepseek.key');
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.replace(/^\uFEFF/, '').trim();
      if (!line || /^[#;]/.test(line)) continue;        // 跳过空行 / 注释行
      const key = line.split(/\s+/)[0];                 // 兼容「Key  备注」同行写法
      if (key) return checkKeyAscii(key, 'deepseek.key 文件');
    }
  }
  return '';
}
let API_KEY = '';
let API_KEY_ERR = '';
try {
  API_KEY = loadKey();
} catch (e) {
  // 内容有问题 ≠ 没配 Key：记录下来，启动照常（手动标记等功能仍可用），
  // 但所有 AI 请求会直接返回这条可读的错误，不再抛难懂的 ByteString 天书
  API_KEY_ERR = e.message;
  console.error('[Key 读取失败] ' + e.message);
  console.error('  → 修复：打开 deepseek.key，确保有一行「只有」API Key 本身（该行不要带 # 注释或中文说明）。');
}

async function callDeepSeek(messages, maxTokens, temperature) {
  if (API_KEY_ERR) throw new Error(API_KEY_ERR);
  if (!API_KEY) throw new Error('服务端未配置 DEEPSEEK_API_KEY');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp, data;
  try {
    resp = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        temperature: temperature == null ? 0.3 : temperature,
        max_tokens: maxTokens || 900,
        response_format: { type: 'json_object' },
        stream: false
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer); throw e;
  }

  try {
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let msg = 'DeepSeek 返回 ' + resp.status;
    try { const j = JSON.parse(text); msg += '：' + (j.error && j.error.message ? j.error.message : text.slice(0, 200)); }
    catch (e) { msg += ' ' + text.slice(0, 200); }
    throw new Error(msg);
  }

  data = await resp.json();
  } finally { clearTimeout(timer); }
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!content) throw new Error('DeepSeek 返回内容为空');

  // json_object 模式下一般已是合法 JSON；遇到 ```json 包裹时剥掉再解析
  let txt = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error('模型返回的不是合法 JSON：' + txt.slice(0, 200));
  }
}


return { callDeepSeek, hasKey: !!API_KEY, keyError: API_KEY_ERR, model: MODEL };
};
