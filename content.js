/* 简译 · 内容脚本 (v1.1):划词翻译气泡 + 整页翻译(双语对照/仅译文)
 * 支持扩展重载后自愈:旧实例失效时自动重新初始化。
 */
(() => {
  /* 每次注入都重新接管:GEN 自增让旧实例全部进入 stale 失效状态。
   * 这样扩展重载/更新后,旧页面无需刷新即可由新注入的脚本接管。 */
  window.__JY_GEN__ = (window.__JY_GEN__ || 0) + 1;
  const GEN = window.__JY_GEN__;
  const stale = () => GEN !== window.__JY_GEN__;

  /* 清掉旧实例残留的 UI */
  document.querySelectorAll('#jy-layer-root').forEach((n) => n.remove());

  /* ---------------- 设置 ---------------- */
  const settings = { target: 'zh-Hans', showBubble: true, pageMode: 'replace', autoRestore: true, autoOffer: true, autoSites: [], neverSites: [] };
  try {
    chrome.storage.sync.get({ target: 'zh-Hans', showBubble: true, pageMode: 'replace', autoRestore: true, autoOffer: true, autoSites: [], neverSites: [] }, (s) => {
      if (!stale() || !s) return;
      Object.assign(settings, s);
      tryAutoRestore(); // 设置就绪后尝试从本地缓存恢复上次翻译
      setTimeout(maybeOfferOrAutoTranslate, 1600); // 谷歌式:询问/自动翻译判定
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (stale()) return;
      for (const k of ['target', 'showBubble', 'pageMode', 'autoRestore', 'autoOffer', 'autoSites', 'neverSites']) {
        if (changes[k] && changes[k].newValue != null) settings[k] = changes[k].newValue;
      }
    });
  } catch (e) { /* 忽略 */ }

  const LANG_NAMES = {
    'zh-Hans': '简体中文', 'zh-TW': '繁体中文', 'en': '英语', 'ja': '日语', 'ko': '韩语',
    'fr': '法语', 'de': '德语', 'ru': '俄语', 'es': '西班牙语', 'pt': '葡萄牙语',
    'it': '意大利语', 'th': '泰语', 'vi': '越南语', 'ar': '阿拉伯语', 'id': '印尼语', 'ms': '马来语'
  };
  const ENG_NAMES = { youdao: '有道', deepl: 'DeepL', mymemory: 'MyMemory' };
  function langName(code) {
    if (!code) return '未知';
    if (LANG_NAMES[code]) return LANG_NAMES[code];
    const base = String(code).split('-')[0];
    return LANG_NAMES[base] || code.toUpperCase();
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(v, b));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- 后台通信 ---------------- */
  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      } catch (e) { resolve(null); }
    });
  }

  /* ---------------- UI 根节点 ---------------- */
  let layer = null;
  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.id = 'jy-layer-root';
    (document.documentElement || document.body).appendChild(layer);
    return layer;
  }

  /* ---------------- 悬浮提示条 ---------------- */
  let barEl = null;
  function showBar(html) {
    ensureLayer();
    if (!barEl || !barEl.isConnected) {
      barEl = document.createElement('div');
      barEl.className = 'jy-bar';
      layer.appendChild(barEl);
    }
    barEl.innerHTML = html;
    barEl.style.display = 'flex';
    return barEl;
  }
  function hideBar() { if (barEl) { barEl.remove(); barEl = null; } }
  function toastMsg(text) {
    const b = showBar('<span class="jy-bar-text"></span>');
    b.querySelector('.jy-bar-text').textContent = text;
    setTimeout(() => { if (!stale() && barEl === b && !pageState.running) hideBar(); }, 4000);
  }

  /* ---------------- 划词气泡 ---------------- */
  let bubbleEl = null, triggerEl = null, scTimer = null;

  function hideBubble() { if (bubbleEl) { bubbleEl.remove(); bubbleEl = null; } }
  function hideTrigger() { if (triggerEl) { triggerEl.remove(); triggerEl = null; } }

  function currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    let rect = null;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) { }
    return { text, rect };
  }

  function showTrigger(rect) {
    if (!settings.showBubble) return;
    ensureLayer();
    if (!triggerEl || !triggerEl.isConnected) {
      triggerEl = document.createElement('div');
      triggerEl.className = 'jy-trigger';
      triggerEl.textContent = '译';
      triggerEl.title = '翻译选中内容(Alt+T)';
      triggerEl.addEventListener('mousedown', (e) => e.preventDefault());
      triggerEl.addEventListener('click', (e) => { e.stopPropagation(); if (!stale()) translateSelection(); });
      layer.appendChild(triggerEl);
    }
    const x = clamp(rect.left + rect.width / 2 - 15, 8, window.innerWidth - 38);
    const y = clamp(rect.top - 36, 8, window.innerHeight - 38);
    triggerEl.style.left = x + 'px';
    triggerEl.style.top = y + 'px';
    triggerEl.style.display = 'flex';
  }

  function copyText(text, tip) {
    const done = () => toastMsg(tip || '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { }
    ta.remove();
  }

  function showBubble(rect) {
    ensureLayer();
    hideBubble();
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'jy-bubble';
    bubbleEl.innerHTML =
      '<div class="jy-bubble-head"><span class="jy-bubble-lang">…</span>' +
      '<span class="jy-bubble-actions"><button class="jy-btn jy-copy">复制</button>' +
      '<button class="jy-btn jy-close">关闭</button></span></div>' +
      '<div class="jy-bubble-body">翻译中…</div>';
    layer.appendChild(bubbleEl);
    const w = Math.min(340, window.innerWidth - 16);
    const x = clamp(rect.left, 8, window.innerWidth - w - 8);
    const y = clamp(rect.bottom + 10, 8, window.innerHeight - 150);
    bubbleEl.style.left = x + 'px';
    bubbleEl.style.top = y + 'px';
    bubbleEl.querySelector('.jy-close').addEventListener('click', hideBubble);
    bubbleEl.querySelector('.jy-copy').addEventListener('click', () => {
      if (!stale() && bubbleEl) copyText(bubbleEl.querySelector('.jy-bubble-body').textContent);
    });
  }

  function translateSelection() {
    const s = currentSelection();
    if (!s) return;
    hideTrigger();
    if (s.text.length > 5000) {
      const rect = s.rect || { left: window.innerWidth / 2 - 170, bottom: 120 };
      showBubble(rect);
      bubbleEl.querySelector('.jy-bubble-body').textContent = '选中文本过长(>5000 字),请分次翻译';
      bubbleEl.querySelector('.jy-bubble-body').classList.add('jy-err');
      return;
    }
    const rect = s.rect || { left: window.innerWidth / 2 - 170, bottom: 120 };
    showBubble(rect);
    const body = bubbleEl.querySelector('.jy-bubble-body');
    const head = bubbleEl.querySelector('.jy-bubble-lang');
    sendBg({ type: 'translateOne', text: s.text, to: settings.target }).then((res) => {
      if (stale() || !bubbleEl) return;
      if (!res || !res.ok) {
        body.textContent = '翻译失败:' + ((res && res.error) || '无法连接翻译服务');
        body.classList.add('jy-err');
        return;
      }
      const r = res.result || {};
      const eng = r.engine ? ' · ' + (ENG_NAMES[r.engine] || r.engine) : '';
      head.textContent = (r.detected ? langName(r.detected) : '自动检测') + ' → ' + langName(settings.target) + eng;
      body.textContent = r.text || '(无翻译结果)';
    });
  }

  /* ---------------- 整页翻译 ---------------- */
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'PRE', 'CODE', 'KBD', 'SAMP', 'VAR',
    'IFRAME', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'TEMPLATE',
    'INPUT', 'SELECT', 'OPTION', 'DATALIST', 'MATH'
  ]);
  const pageState = { running: false, cancel: false, records: [], done: new Set(), cache: new Map() };

  /* 文本是否已是目标语言(避免中文页→中文之类的无谓请求) */
  function looksLikeTargetLang(text, target) {
    const base = String(target).split('-')[0];
    if (base === 'zh') {
      const hasKana = /[\u3040-\u30ff]/.test(text);
      const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      return !hasKana && cjk > 0 && cjk / text.length > 0.2;
    }
    if (base === 'ja') return /[\u3040-\u30ff]/.test(text);
    if (base === 'ko') return /[\uac00-\ud7af]/.test(text);
    if (base === 'en') return !/[^\x00-\x7F]/.test(text) && /[A-Za-z]/.test(text);
    return false;
  }

  function isTranslatableText(t) {
    const s = t.trim();
    if (s.length < 2 || s.length > 1500) return false;
    if (!/\p{L}/u.test(s)) return false; // 纯数字/符号不译
    return true;
  }

  function collectTextNodes() {
    const out = [];
    const root = document.body;
    if (!root) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
        try {
          if (p.closest('#jy-layer-root')) return NodeFilter.FILTER_REJECT;
          if (p.closest('.jy-bi')) return NodeFilter.FILTER_REJECT;
        } catch (e) { }
        const v = node.nodeValue;
        if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
        if (!isTranslatableText(v)) return NodeFilter.FILTER_REJECT;
        if (pageState.done.has(node)) return NodeFilter.FILTER_REJECT;
        if (looksLikeTargetLang(v.trim(), settings.target)) return NodeFilter.FILTER_REJECT;
        try {
          if (p.checkVisibility && !p.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) {
            return NodeFilter.FILTER_REJECT;
          }
        } catch (e) { }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  function chunkNodes(nodes) {
    const chunks = [];
    let cur = [], size = 0;
    for (const n of nodes) {
      const len = n.nodeValue.length;
      if (cur.length && (size + len > 3000 || cur.length >= 40)) {
        chunks.push(cur); cur = []; size = 0;
      }
      cur.push(n); size += len;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  function sameLanguage(detected, target) {
    if (!detected) return false;
    if (detected === target) return true;
    const d = String(detected).split('-')[0];
    const t = String(target).split('-')[0];
    if (d !== t) return false;
    if (d === 'zh') return detected === 'zh';
    return true;
  }

  function applyTranslation(node, translated) {
    const srcKey = node.nodeValue.trim();
    if (srcKey) pageState.cache.set(srcKey, translated); // 供"显示原文/译文"切换使用
    if (settings.pageMode === 'replace') {
      pageState.records.push({ node, original: node.nodeValue });
      node.nodeValue = translated;
    } else {
      const span = document.createElement('span');
      span.className = 'jy-bi';
      span.textContent = translated;
      if (node.parentNode) node.parentNode.insertBefore(span, node.nextSibling);
      pageState.records.push({ node, original: null, inserted: span });
    }
    pageState.done.add(node);
  }

  async function translatePage() {
    if (pageState.running) return;
    const target = settings.target;
    const nodes = collectTextNodes();
    console.log('[简译] 整页翻译:收集到', nodes.length, '段待译文本');
    if (!nodes.length) {
      toastMsg(pageState.records.length ? '本页已翻译,没有新增内容' : '本页无需翻译(可能已是目标语言)');
      return;
    }
    pageState.running = true;
    pageState.cancel = false;
    const startLen = pageState.records.length;
    const chunks = chunkNodes(nodes);
    let done = 0, failed = 0;
    const bar = showBar('<span class="jy-bar-text">准备翻译…</span><button class="jy-btn jy-cancel">取消</button>');
    bar.querySelector('.jy-cancel').addEventListener('click', () => { pageState.cancel = true; });

    for (const chunk of chunks) {
      if (pageState.cancel || stale()) break;
      const texts = chunk.map((n) => n.nodeValue.trim());
      const res = await sendBg({ type: 'translateTexts', texts, to: target });
      if (pageState.cancel || stale()) break;
      if (!res || !res.ok) {
        pageState.running = false;
        const b2 = showBar('<span class="jy-bar-text"></span><button class="jy-btn jy-close-bar">关闭</button>');
        b2.querySelector('.jy-bar-text').textContent =
          '翻译失败:' + ((res && res.error) || '无法连接翻译服务(请稍后重试)');
        b2.querySelector('.jy-close-bar').addEventListener('click', hideBar);
        return;
      }
      const engName = res.engine ? (ENG_NAMES[res.engine] || res.engine) : '自动';
      chunk.forEach((node, i) => {
        done += 1;
        const r = res.results && res.results[i];
        if (!r || !r.text) { failed += 1; return; }
        if (sameLanguage(r.detected, target)) return;
        const key = node.nodeValue.trim();
        let t = pageState.cache.get(key);
        if (t == null) { t = r.text; pageState.cache.set(key, t); }
        applyTranslation(node, t);
      });
      bar.querySelector('.jy-bar-text').textContent =
        '翻译中 ' + done + '/' + nodes.length + ' · 引擎:' + engName + ' · ' +
        (settings.pageMode === 'bilingual' ? '双语对照' : '仅译文');
      await sleep(100);
    }

    pageState.running = false;
    if (stale()) return;
    if (pageState.cancel) { savePageCache(); toastMsg('已取消(已翻译部分保留)'); return; }
    if (pageState.records.length === startLen) {
      toastMsg(failed > 0
        ? '翻译失败:' + failed + ' 条文本未成功(引擎限流,请稍后重试)'
        : '没有需要翻译的内容(页面可能已是目标语言)');
      return;
    }
    savePageCache(); // 缓存本次翻译结果,下次打开同一页面可秒恢复
    const b3 = showBar('<span class="jy-bar-text">整页翻译完成' + (failed > 0 ? '(失败 ' + failed + ' 条)' : '') + '</span>' +
      '<button class="jy-btn jy-toggle">显示原文</button><button class="jy-btn jy-close-bar">关闭</button>');
    b3.querySelector('.jy-toggle').addEventListener('click', (e) => { if (!stale()) toggleOriginal(e.target); });
    b3.querySelector('.jy-close-bar').addEventListener('click', hideBar);
  }

  function restorePage() {
    pageState.cancel = true;
    for (let i = pageState.records.length - 1; i >= 0; i--) {
      const rec = pageState.records[i];
      try {
        if (rec.inserted) { if (rec.inserted.parentNode) rec.inserted.remove(); }
        else if (rec.node) rec.node.nodeValue = rec.original;
      } catch (e) { /* 节点可能已被页面移除 */ }
    }
    pageState.records = [];
    pageState.done = new Set();
    pageState.cache.clear();
    pageState.originalShown = false;
    clearPageCache(); // 手动恢复原文后,不再自动恢复该页
    hideBar();
  }

  /* ---------------- 本地缓存:同一页面秒恢复上次翻译 ---------------- */
  function pageKey() {
    try { return location.origin + location.pathname + location.search; }
    catch (e) { return String(location.href || ''); }
  }

  function buildPairs() {
    const pairs = {};
    for (const rec of pageState.records) {
      try {
        const src = String(rec.original != null ? rec.original : rec.node.nodeValue || '').trim();
        const dst = String(rec.original != null ? rec.node.nodeValue : (rec.inserted ? rec.inserted.textContent : '')).trim();
        if (src && dst && src !== dst) pairs[src] = dst;
      } catch (e) { }
    }
    return pairs;
  }

  function savePageCache() {
    if (!settings.autoRestore) return;
    try {
      const pairs = buildPairs();
      const n = Object.keys(pairs).length;
      if (n === 0) return;
      // 缓存由后台统一写入(日志出现在 Service Worker 控制台,页面跳转也不丢)
      chrome.runtime.sendMessage({ type: 'savePageCache', url: pageKey(), target: settings.target, mode: settings.pageMode, pairs: pairs }, () => void chrome.runtime.lastError);
    } catch (e) { }
  }

  function clearPageCache() {
    try {
      chrome.runtime.sendMessage({ type: 'clearPageCache', url: pageKey() }, () => void chrome.runtime.lastError);
    } catch (e) { }
  }

  async function tryAutoRestore() {
    if (!settings.autoRestore || pageState.records.length) return;
    const res = await sendBg({ type: 'getPageCache', url: pageKey(), target: settings.target });
    if (stale()) return;
    if (!res || !res.ok || !res.pairs) {
      console.log('[简译] 自动恢复:后台无匹配缓存(未缓存过/URL不同/目标语言不同)');
      return;
    }
    const pairs = res.pairs;
    const pairsN = Object.keys(pairs).length;
    let total = 0;
    // 多次尝试:动态渲染的页面正文出现较晚,越晚的尝试越可能匹配到
    for (const delay of [500, 1500, 3500, 7000]) {
      await sleep(delay);
      if (stale() || pageState.running) return; // 手动翻译已开始,交给它处理
      const applied = await applyFromCache(pairs);
      if (applied > 0) {
        total += applied;
        console.log('[简译] 自动恢复:本次应用', applied, '段,累计', total, '段(缓存共', pairsN, '段)');
        const b = showBar('<span class="jy-bar-text">已恢复上次翻译(' + total + ' 段)</span>' +
          '<button class="jy-btn jy-toggle">显示原文</button><button class="jy-btn jy-close-bar">关闭</button>');
        b.querySelector('.jy-toggle').addEventListener('click', (e) => { if (!stale()) toggleOriginal(e.target); });
        b.querySelector('.jy-close-bar').addEventListener('click', hideBar);
      }
    }
    if (!total) console.log('[简译] 自动恢复:缓存', pairsN, '段与页面内容无匹配(页面可能动态变化)');
  }

  async function applyFromCache(pairs) {
    const nodes = collectTextNodes();
    let applied = 0;
    for (const node of nodes) {
      const src = node.nodeValue.trim();
      const t = pairs[src];
      if (t && t !== src) { applyTranslation(node, t); applied++; }
    }
    return applied;
  }

  /* ---------------- 谷歌式交互:外语页提示条 / 站点记忆 / 显示原文 ---------------- */
  function guessLangLocal(text) {
    if (/[\u3040-\u30ff]/.test(text)) return 'ja';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko';
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh-Hans';
    if (!/[^\x00-\x7F]/.test(text) && /[A-Za-z]/.test(text)) return 'en';
    return null;
  }

  function pageLooksForeign() {
    try {
      const sample = ((document.body && document.body.innerText) || '').slice(0, 3000).trim();
      if (sample.length < 150) return false;
      return !looksLikeTargetLang(sample, settings.target);
    } catch (e) { return false; }
  }

  function rememberSite(listName) {
    const host = location.hostname;
    if (!host) return;
    settings[listName] = Array.isArray(settings[listName]) ? settings[listName] : [];
    if (!settings[listName].includes(host)) {
      settings[listName].push(host);
      try { chrome.storage.sync.set({ [listName]: settings[listName] }, () => void chrome.runtime.lastError); } catch (e) { }
    }
  }

  function showOfferBar() {
    const sample = ((document.body && document.body.innerText) || '').slice(0, 500);
    const srcGuess = guessLangLocal(sample);
    const srcName = srcGuess ? langName(srcGuess) : '外语';
    const b = showBar('<span class="jy-bar-text">检测到' + srcName + '页面,翻译成' + langName(settings.target) + '吗?</span>' +
      '<button class="jy-btn jy-yes">翻译此页</button>' +
      '<button class="jy-btn jy-always">此站总是翻译</button>' +
      '<button class="jy-btn jy-never">此站不再询问</button>' +
      '<button class="jy-btn jy-dismiss">×</button>');
    b.querySelector('.jy-yes').addEventListener('click', () => { hideBar(); if (!stale()) translatePage(); });
    b.querySelector('.jy-always').addEventListener('click', () => { rememberSite('autoSites'); hideBar(); if (!stale()) translatePage(); });
    b.querySelector('.jy-never').addEventListener('click', () => { rememberSite('neverSites'); hideBar(); });
    b.querySelector('.jy-dismiss').addEventListener('click', hideBar);
  }

  function maybeOfferOrAutoTranslate() {
    if (stale() || pageState.running || pageState.records.length) return;
    const host = location.hostname;
    if (settings.neverSites && settings.neverSites.includes(host)) return;
    if (settings.autoSites && settings.autoSites.includes(host)) { translatePage(); return; }
    if (settings.autoOffer && pageLooksForeign()) showOfferBar();
  }

  function toggleOriginal(btn) {
    pageState.originalShown = !pageState.originalShown;
    if (pageState.originalShown) {
      for (const rec of pageState.records) {
        try {
          if (rec.inserted) rec.inserted.style.display = 'none';
          else if (rec.node) rec.node.nodeValue = rec.original;
        } catch (e) { }
      }
      if (btn) btn.textContent = '显示译文';
    } else {
      for (const rec of pageState.records) {
        try {
          if (rec.inserted) rec.inserted.style.display = '';
          else if (rec.node) {
            const t = pageState.cache.get(String(rec.original || '').trim());
            if (t != null) rec.node.nodeValue = t;
          }
        } catch (e) { }
      }
      if (btn) btn.textContent = '显示原文';
    }
  }

  function togglePageTranslate() {
    if (pageState.running) { pageState.cancel = true; return; }
    if (pageState.records.length) restorePage();
    else translatePage();
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('mouseup', (e) => {
    if (stale()) return;
    if (layer && layer.contains(e.target)) return;
    setTimeout(() => {
      if (stale()) return;
      const s = currentSelection();
      if (s && s.text.length <= 5000 && s.rect) showTrigger(s.rect);
      else hideTrigger();
    }, 10);
  });

  document.addEventListener('selectionchange', () => {
    if (stale()) return;
    clearTimeout(scTimer);
    scTimer = setTimeout(() => {
      if (!stale() && !currentSelection()) hideTrigger();
    }, 60);
  });

  document.addEventListener('mousedown', (e) => {
    if (stale()) return;
    if (layer && layer.contains(e.target)) return;
    hideBubble();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (stale()) return;
    if (e.key === 'Escape') { hideBubble(); hideTrigger(); }
  });

  document.addEventListener('scroll', () => { if (!stale()) hideTrigger(); }, true);
  window.addEventListener('resize', () => { if (!stale()) hideTrigger(); });

  /* 前进/后退缓存(bfcache)恢复:若站点重新渲染清掉了译文,从缓存补上 */
  window.addEventListener('pageshow', (e) => {
    if (stale() || !e.persisted || !settings.autoRestore || !pageState.records.length) return;
    setTimeout(async () => {
      if (stale()) return;
      const res = await sendBg({ type: 'getPageCache', url: pageKey(), target: settings.target });
      if (res && res.ok && res.pairs) {
        const applied = await applyFromCache(res.pairs);
        if (applied > 0) console.log('[简译] bfcache 恢复:补上', applied, '段被站点重渲染清除的译文');
      }
    }, 300);
  });

  /* 接收来自右键菜单 / 快捷键 / 弹窗的指令 */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (stale()) return undefined; // 旧实例不响应,让新实例接管
    const run = (fn) => { try { fn(); } catch (e) { toastMsg('简译出错:' + (e && e.message ? e.message : e)); } };
    try {
      if (msg.type === 'ping') { sendResponse({ ok: true }); }
      else if (msg.type === 'translateSelection') { run(translateSelection); sendResponse({ ok: true }); }
      else if (msg.type === 'translatePage') { run(translatePage); sendResponse({ ok: true }); }
      else if (msg.type === 'togglePageTranslate') { run(togglePageTranslate); sendResponse({ ok: true }); }
      else if (msg.type === 'restorePage') { run(restorePage); sendResponse({ ok: true }); }
    } catch (e) { sendResponse({ ok: false }); }
    return undefined;
  });
})();