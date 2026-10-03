/* 简译 · 弹窗逻辑 */
const DEFAULTS = { target: 'zh-Hans', showBubble: true, pageMode: 'replace', autoRestore: true };
const el = (id) => document.getElementById(id);
let settings = Object.assign({}, DEFAULTS);

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = Object.assign({}, DEFAULTS, s || {});
    el('target').value = settings.target;
    el('showBubble').checked = !!settings.showBubble;
    el('autoRestore').checked = !!settings.autoRestore;
    document.querySelectorAll('input[name="mode"]').forEach((r) => {
      r.checked = r.value === settings.pageMode;
    });
  });
}

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.sync.set(patch);
}

/* -------- 快速翻译 -------- */
function quickTranslate() {
  const text = el('input').value.trim();
  const out = el('output');
  const meta = el('meta');
  if (!text) { out.textContent = '—'; meta.textContent = ''; return; }
  if (text.length > 20000) {
    out.textContent = '文本过长，请分次翻译';
    out.classList.add('jy-err-out');
    meta.textContent = '';
    return;
  }
  out.textContent = '翻译中…';
  meta.textContent = '';
  chrome.runtime.sendMessage({ type: 'translateOne', text, to: settings.target }, (res) => {
    const err = chrome.runtime.lastError;
    if (err || !res || !res.ok) {
      out.textContent = '翻译失败';
      meta.textContent = (res && res.error) || (err && err.message) || '';
      return;
    }
    const r = res.result || {};
    out.textContent = r.text || '（无结果）';
    meta.textContent = r.detected ? ('检测语言：' + r.detected + ' → ' + settings.target) : '';
  });
}

/* -------- 向当前标签页发指令 -------- */
function sendToActiveTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== 'number') return;
    chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
  });
}

/* -------- 事件绑定 -------- */
document.addEventListener('DOMContentLoaded', loadSettings);
loadSettings();

el('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); quickTranslate(); }
});

el('target').addEventListener('change', () => {
  save({ target: el('target').value });
  if (el('input').value.trim()) quickTranslate();
});

document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.addEventListener('change', () => { if (r.checked) save({ pageMode: r.value }); });
});

el('showBubble').addEventListener('change', () => {
  save({ showBubble: el('showBubble').checked });
});

el('autoRestore').addEventListener('change', () => {
  save({ autoRestore: el('autoRestore').checked });
});

el('translatePage').addEventListener('click', () => {
  pageAction('translatePage');
});

el('restorePage').addEventListener('click', () => {
  pageAction('restorePage');
});

/* 弹窗的页面指令经由后台发送(后台会先自动注入页面脚本) */
function pageAction(action) {
  chrome.runtime.sendMessage({ type: 'pageAction', action }, (res) => {
    const err = chrome.runtime.lastError;
    if (err || !res || !res.ok) {
      el('meta').textContent = '⚠ ' + ((res && res.error) || (err && err.message) || '指令发送失败');
      return; // 不关闭弹窗,让用户看到原因
    }
    setTimeout(() => window.close(), 150);
  });
}

el('openShortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

/* -------- 引擎状态与测试 -------- */
const ENG_NAMES = { youdao: '有道翻译', deepl: 'DeepL', mymemory: 'MyMemory' };

chrome.runtime.sendMessage({ type: 'engineInfo' }, (res) => {
  if (chrome.runtime.lastError || !res || !res.ok) return;
  if (res.name) el('meta').textContent = '上次使用引擎:' + res.name;
});

el('testEngine').addEventListener('click', () => {
  const out = el('output');
  const meta = el('meta');
  const sample = 'Hello, world! This is a translation test.';
  out.textContent = '正在测试翻译服务…';
  meta.textContent = '';
  const t0 = Date.now();
  chrome.runtime.sendMessage({ type: 'translateOne', text: sample, to: settings.target }, (res) => {
    const err = chrome.runtime.lastError;
    if (err || !res || !res.ok) {
      out.textContent = '测试失败';
      meta.textContent = (res && res.error) || (err && err.message) || '';
      return;
    }
    const r = res.result || {};
    out.textContent = r.text || '(无结果)';
    const eng = r.engine ? (ENG_NAMES[r.engine] || r.engine) : '';
    meta.textContent = '引擎:' + eng + ' · 耗时 ' + (Date.now() - t0) + 'ms';
  });
});