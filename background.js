/* 简译 · 后台服务 Worker (v1.1)
 * 免翻墙多引擎链路(均国内直连、无需 API Key),失败自动切换:
 *   1) 有道翻译   aidemo.youdao.com           —— 快,单条 ≤700 字,突发频繁会限流
 *   2) DeepL     www2.deepl.com/jsonrpc      —— 质量高,支持长文本与更多语言,限速较严
 *   3) MyMemory  api.mymemory.translated.net —— 兜底
 * 引擎被限流后进入冷却,期间自动改用下一个引擎。
 */

const YOUDAO_URL = 'https://aidemo.youdao.com/trans';
const DEEPL_URL = 'https://www2.deepl.com/jsonrpc';
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

const ENGINE_NAMES = { youdao: '有道翻译', deepl: 'DeepL', mymemory: 'MyMemory' };
const ENGINE_ORDER = ['youdao', 'deepl', 'mymemory'];
const YOU_MAX_LEN = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 目标语言 → 各引擎的语言代码 */
const YOU_TO = {
  'zh-Hans': 'zh-CHS', 'zh-TW': 'zh-CHT', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
  'fr': 'fr', 'de': 'de', 'ru': 'ru', 'es': 'es', 'pt': 'pt', 'it': 'it',
  'th': 'th', 'vi': 'vi', 'ar': 'ar'
};
const DEEPL_TO = {
  'zh-Hans': 'ZH', 'zh-TW': 'ZH-HANT', 'en': 'EN', 'ja': 'JA', 'ko': 'KO',
  'fr': 'FR', 'de': 'DE', 'ru': 'RU', 'es': 'ES', 'pt': 'PT', 'it': 'IT', 'ar': 'AR'
};
const MM_TO = {
  'zh-Hans': 'zh-CN', 'zh-TW': 'zh-TW', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
  'fr': 'fr', 'de': 'de', 'ru': 'ru', 'es': 'es', 'pt': 'pt', 'it': 'it',
  'th': 'th', 'vi': 'vi', 'ar': 'ar'
};

/* 引擎冷却表:限流后暂停一段时间,期间自动跳到下一个引擎 */
const cooldownUntil = {};
function inCooldown(e) { return (cooldownUntil[e] || 0) > Date.now(); }
function setCooldown(e, ms) { cooldownUntil[e] = Date.now() + ms; }

let lastEngine = null;

/* 简易语言猜测:给需要源语言的兜底引擎(如 MyMemory)提供提示 */
function guessLang(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';       // 日语假名
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';       // 韩文
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';       // 西里尔
  if (/[\u0e00-\u0e7f]/.test(text)) return 'th';       // 泰文
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';       // 阿拉伯
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-Hans';  // 汉字
  if (!/[^\x00-\x7F]/.test(text) && /[A-Za-z]/.test(text)) return 'en'; // 纯ASCII
  return null;
}

/* ---------------- 引擎实现 ---------------- */

async function youdaoTranslate(text, to) {
  if (text.length > YOU_MAX_LEN) throw new Error('有道:文本超长');
  const target = YOU_TO[to];
  if (!target) throw new Error('有道:不支持该语言');
  const res = await fetch(YOUDAO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ q: text, from: 'auto', to: target }).toString()
  });
  if (!res.ok) throw new Error('有道:HTTP ' + res.status);
  const data = await res.json();
  const code = String(data.errorCode == null ? '' : data.errorCode);
  if (code !== '0') {
    if (code === '411' || code === '102') {
      setCooldown('youdao', 45000);
      throw new Error('有道:请求过于频繁');
    }
    throw new Error('有道:errorCode ' + code);
  }
  const t = data.translation && data.translation[0];
  if (!t) throw new Error('有道:无结果');
  return { detected: null, text: t };
}

/* 有道批量:多行合并单次请求,实测逐行严格对齐(谷歌式秒翻的关键) */
async function youdaoTranslateBatch(lines, to) {
  const target = YOU_TO[to];
  if (!target) throw new Error('有道:不支持该语言');
  const q = lines.join('\n');
  if (q.length > 700) throw new Error('有道:批量块超长');
  const res = await fetch(YOUDAO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ q: q, from: 'auto', to: target }).toString()
  });
  if (!res.ok) throw new Error('有道:HTTP ' + res.status);
  const data = await res.json();
  const code = String(data.errorCode == null ? '' : data.errorCode);
  if (code !== '0') {
    if (code === '411' || code === '102') {
      setCooldown('youdao', 45000);
      throw new Error('有道:请求过于频繁');
    }
    throw new Error('有道:errorCode ' + code);
  }
  const t = data.translation && data.translation[0];
  if (!t) throw new Error('有道:无结果');
  const parts = String(t).split(/\r?\n/);
  if (parts.length !== lines.length) throw new Error('有道:行数不匹配(' + parts.length + '/' + lines.length + ')');
  return parts;
}

let deeplSeq = Math.floor(Math.random() * 900000) + 100000;

async function deeplTranslate(text, to) {
  const target = DEEPL_TO[to];
  if (!target) throw new Error('DeepL:不支持该语言');
  deeplSeq += 1;
  let id = deeplSeq;
  if ((id + 5) % 29 === 0 || (id + 3) % 13 === 0) id += 1; // 避开 DeepL 的特殊 id 校验
  const body = {
    jsonrpc: '2.0',
    method: 'LMT_handle_texts',
    id,
    params: {
      texts: [{ text, requestAlternatives: 0 }],
      splitting: 'newlines',
      lang: { target_lang: target, source_lang_user_selected: 'auto' },
      timestamp: Date.now()
    }
  };
  const res = await fetch(DEEPL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 429) { setCooldown('deepl', 25000); throw new Error('DeepL:请求过于频繁'); }
  if (!res.ok) throw new Error('DeepL:HTTP ' + res.status);
  const data = await res.json();
  const r = data && data.result;
  const t = r && r.texts && r.texts[0] && r.texts[0].text;
  if (!t) throw new Error('DeepL:无结果');
  return { detected: r.lang ? String(r.lang).toLowerCase() : null, text: t };
}

async function mymemoryTranslate(text, to, hint) {
  const target = MM_TO[to];
  if (!target) throw new Error('MyMemory:不支持该语言');
  const srcCode = (hint && MM_TO[hint]) ? hint : guessLang(text);
  const source = (srcCode && MM_TO[srcCode]) ? MM_TO[srcCode] : 'Autodetect';
  const url = MYMEMORY_URL +
    '?q=' + encodeURIComponent(text) +
    '&langpair=' + encodeURIComponent(source + '|' + target) +
    '&de=jianyi-translate%40example.com';
  const res = await fetch(url);
  if (res.status === 429) { setCooldown('mymemory', 30000); throw new Error('MyMemory:请求过于频繁'); }
  if (!res.ok) throw new Error('MyMemory:HTTP ' + res.status);
  const data = await res.json();
  const t = data && data.responseData && data.responseData.translatedText;
  if (!t) throw new Error('MyMemory:无结果');
  if (source === 'Autodetect' && t === text) throw new Error('MyMemory:无法检测语言');
  return { detected: srcCode || null, text: t };
}

/* ---------------- 引擎调度 ---------------- */

async function translateSingle(text, to, hint) {
  let lastErr = null;
  for (const eng of ENGINE_ORDER) {
    if (inCooldown(eng)) continue;
    try {
      let r;
      if (eng === 'youdao') r = await youdaoTranslate(text, to);
      else if (eng === 'deepl') r = await deeplTranslate(text, to);
      else r = await mymemoryTranslate(text, to, hint);
      lastEngine = eng;
      return { engine: eng, detected: r.detected, text: r.text };
    } catch (e) {
      lastErr = e;
      if (!inCooldown(eng)) await sleep(120);
    }
  }
  throw lastErr || new Error('所有翻译引擎均不可用');
}

/* 并发池:limit 个 worker 消费队列,每条之间留间隔 */
async function pooledMap(items, limit, fn, gapMin, gapMax) {
  const out = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        out[i] = await fn(items[i], i);
        await sleep(gapMin + Math.random() * (gapMax - gapMin));
      } catch (e) {
        out[i] = null;
        console.warn('[简译] 条目失败:' + ((e && e.message) ? e.message : e));
        await sleep(400);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function translateMany(texts, to) {
  const uniq = [...new Set(texts)];
  console.log('[简译] 批量翻译开始:' + uniq.length + ' 条去重文本 → ' + to);
  const out = new Array(uniq.length).fill(null);
  let engine = null;

  /* 阶段1:有道换行批量(每块 ≤25 行且 ≤600 字符,一次请求翻 25 段) */
  if (!inCooldown('youdao')) {
    const chunks = [];
    let cur = [], size = 0;
    uniq.forEach((t, i) => {
      if (cur.length && (cur.length >= 25 || size + t.length > 600)) { chunks.push(cur); cur = []; size = 0; }
      cur.push({ i: i, t: t }); size += t.length;
    });
    if (cur.length) chunks.push(cur);
    for (const chunk of chunks) {
      if (inCooldown('youdao')) break;
      try {
        const parts = await youdaoTranslateBatch(chunk.map((c) => c.t), to);
        chunk.forEach((c, j) => { out[c.i] = { engine: 'youdao', detected: null, text: parts[j] }; });
        engine = 'youdao';
        await sleep(450 + Math.random() * 300);
      } catch (e) {
        console.warn('[简译] 批量块失败(' + ((e && e.message) || e) + '),余量转逐条');
        break;
      }
    }
  }

  /* 阶段2:剩余文本逐条级联(有道→DeepL→MyMemory) */
  let hint = null; // 页面级语言提示:任一条检测出语言后,供兜底引擎使用
  const learn = (r) => { if (r && r.detected && !hint) hint = r.detected; };
  const todo = [];
  uniq.forEach((t, i) => { if (!out[i]) todo.push(i); });
  if (todo.length) {
    const res2 = await pooledMap(todo, 2, async (i) => {
      const r = await translateSingle(uniq[i], to, hint);
      learn(r);
      return r;
    }, 250, 500);
    res2.forEach((r, j) => { out[todo[j]] = r; });
  }

  /* 阶段3:失败自动重试一轮(冷却中的引擎会自动跳过,此时语言提示已就绪) */
  const failedIdx = [];
  out.forEach((r, i) => { if (!r) failedIdx.push(i); });
  if (failedIdx.length) {
    console.log('[简译] 自动重试 ' + failedIdx.length + ' 条失败文本…');
    await sleep(1500);
    for (const i of failedIdx) {
      try {
        const r = await translateSingle(uniq[i], to, hint);
        learn(r);
        out[i] = r;
        await sleep(700);
      } catch (e) {
        await sleep(900);
      }
    }
  }

  let failed = 0, lastErr = null;
  out.forEach((r) => { if (!r) failed++; else if (!engine) engine = r.engine; });
  console.log('[简译] 批量翻译完成:引擎 ' + (engine || '?') + ',失败 ' + failed + '/' + uniq.length);
  if (failed >= uniq.length) {
    try { await translateSingle(uniq[0], to, hint); } catch (e) { lastErr = e; }
    throw lastErr || new Error('所有翻译引擎均不可用');
  }
  const map = new Map();
  uniq.forEach((t, i) => map.set(t, out[i]));
  return { engine, failed, results: texts.map((t) => map.get(t)) };
}

/* ---------------- 消息处理 ---------------- */

/* 页面翻译缓存(供返回页面时秒恢复),由后台统一读写 */
async function getCacheEntries() {
  const d = await chrome.storage.local.get({ jyPageCache: {} });
  return (d && d.jyPageCache) || {};
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === 'translateOne' && typeof msg.text === 'string') {
        const r = await translateSingle(msg.text.trim(), msg.to || 'zh-Hans', null);
        sendResponse({ ok: true, result: r });
      } else if (msg && msg.type === 'translateTexts' && Array.isArray(msg.texts)) {
        const r = await translateMany(msg.texts, msg.to || 'zh-Hans');
        sendResponse({ ok: true, engine: r.engine, failed: r.failed, results: r.results });
      } else if (msg && msg.type === 'engineInfo') {
        sendResponse({ ok: true, engine: lastEngine, name: lastEngine ? ENGINE_NAMES[lastEngine] : null });
      } else if (msg && msg.type === 'savePageCache' && msg.url && msg.pairs) {
        const pairs = msg.pairs;
        const n = Object.keys(pairs).length;
        if (n === 0 || n > 4000) { sendResponse({ ok: false }); return; }
        const entries = await getCacheEntries();
        entries[msg.url] = { t: Date.now(), target: msg.target || 'zh-Hans', mode: msg.mode || 'replace', pairs: pairs };
        const keys = Object.keys(entries);
        if (keys.length > 30) { // LRU:只保留最近 30 页
          keys.sort((a, b) => (entries[a].t || 0) - (entries[b].t || 0));
          for (const k of keys.slice(0, keys.length - 30)) delete entries[k];
        }
        await chrome.storage.local.set({ jyPageCache: entries });
        console.log('[简译] 已缓存本页 ' + n + ' 段译文(当前共缓存 ' + keys.length + ' 页)→ ' + msg.url);
        sendResponse({ ok: true });
      } else if (msg && msg.type === 'getPageCache' && msg.url) {
        const entries = await getCacheEntries();
        const entry = entries[msg.url];
        if (entry && entry.pairs && entry.target === (msg.target || 'zh-Hans')) {
          entry.t = Date.now(); // 命中即刷新 LRU 时间戳
          await chrome.storage.local.set({ jyPageCache: entries });
          console.log('[简译] 缓存命中 ' + Object.keys(entry.pairs).length + ' 段 → ' + msg.url);
          sendResponse({ ok: true, pairs: entry.pairs });
        } else {
          console.log('[简译] 缓存未命中 → ' + msg.url);
          sendResponse({ ok: false });
        }
      } else if (msg && msg.type === 'clearPageCache' && msg.url) {
        const entries = await getCacheEntries();
        if (entries[msg.url]) {
          delete entries[msg.url];
          await chrome.storage.local.set({ jyPageCache: entries });
          console.log('[简译] 已清除页面缓存 → ' + msg.url);
        }
        sendResponse({ ok: true });
      } else if (msg && msg.type === 'pageAction') {
        // 弹窗按钮走这里:先确保页面已注入脚本,再转发指令
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        if (!tab || typeof tab.id !== 'number') {
          sendResponse({ ok: false, error: '未找到活动标签页' });
          return;
        }
        const inj = await ensureInjected(tab.id);
        if (!inj.ok) {
          badgeFail(tab.id);
          sendResponse({ ok: false, error: inj.error || '此页面类型无法注入翻译脚本' });
          return;
        }
        console.log('[简译] 页面指令 ' + msg.action + ' → tab ' + tab.id);
        try {
          chrome.tabs.sendMessage(tab.id, { type: msg.action }, () => void chrome.runtime.lastError);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: '指令发送失败' });
        }
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) ? e.message : String(e) });
    }
  })();
  return true; // 异步响应
});

/* ---------------- 页面注入(扩展更新/重载后,旧页面无需手动刷新) ---------------- */

function pingTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'ping' }, (res) => {
        void chrome.runtime.lastError;
        resolve(!!(res && res.ok));
      });
    } catch (e) { resolve(false); }
  });
}

async function ensureInjected(tabId) {
  if (await pingTab(tabId)) return { ok: true };
  let err = null;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    err = e;
  }
  if (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.warn('[简译] 注入失败, tab ' + tabId + ':', msg);
    return { ok: false, error: msg };
  }
  if (await pingTab(tabId)) return { ok: true };
  console.warn('[简译] 注入后脚本无响应, tab ' + tabId + '(请刷新页面重试)');
  return { ok: false, error: '注入后脚本无响应,请刷新页面后重试' };
}

function badgeFail(tabId) {
  try {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#d4380d' });
    chrome.action.setBadgeText({ tabId, text: '!' });
    chrome.action.setTitle({ tabId, title: '简译:此页面类型无法注入翻译脚本' });
    setTimeout(() => { try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (e) { } }, 5000);
  } catch (e) { }
}

async function sendToTab(tabId, msg) {
  const inj = await ensureInjected(tabId);
  if (!inj.ok) {
    badgeFail(tabId);
    console.warn('[简译] 无法向 tab ' + tabId + ' 发送指令' + (inj.error ? ':' + inj.error : ''));
    return;
  }
  console.log('[简译] 页面指令 ' + msg.type + ' → tab ' + tabId);
  try {
    chrome.tabs.sendMessage(tabId, msg, () => void chrome.runtime.lastError);
  } catch (e) { /* 忽略 */ }
}

/* ---------------- 右键菜单 ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  const done = () => void chrome.runtime.lastError;
  chrome.contextMenus.create({ id: 'jy-selection', title: '翻译选中文字', contexts: ['selection'] }, done);
  chrome.contextMenus.create({ id: 'jy-page', title: '翻译整个页面', contexts: ['page'] }, done);
  chrome.contextMenus.create({ id: 'jy-restore', title: '恢复页面原文', contexts: ['page'] }, done);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || typeof tab.id !== 'number') return;
  if (info.menuItemId === 'jy-selection') sendToTab(tab.id, { type: 'translateSelection' });
  else if (info.menuItemId === 'jy-page') sendToTab(tab.id, { type: 'togglePageTranslate' });
  else if (info.menuItemId === 'jy-restore') sendToTab(tab.id, { type: 'restorePage' });
});

/* ---------------- 快捷键 ---------------- */

chrome.commands.onCommand.addListener((cmd) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== 'number') return;
    if (cmd === 'translate-selection') sendToTab(tab.id, { type: 'translateSelection' });
    else if (cmd === 'toggle-page-translate') sendToTab(tab.id, { type: 'togglePageTranslate' });
  });
});