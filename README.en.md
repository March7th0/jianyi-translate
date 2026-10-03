# JianYi Translate · jianyi-translate

[简体中文](README.md) | **English**

![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-1.3.0-blue)
![Platform](https://img.shields.io/badge/Chrome%20%2F%20Edge-Manifest%20V3-orange)

A VPN-free web page translator for Chrome / Edge: selection translation, full-page translation, an automatic offer bar on foreign pages, and instant restore when you revisit a translated page.

Powered by Youdao / DeepL / MyMemory with automatic engine failover — **works in mainland China directly. No proxy, no API key.**

## Features

| Feature | Description |
| --- | --- |
| Selection translation | Select text → click the floating “译” button (or press `Alt+T`) to see the result in a bubble, one-click copy |
| Full-page translation | Press `Alt+P` or click “翻译本页” in the popup. Defaults to **translation-only** (switchable to bilingual in the popup); toggle **Show original / Show translation** anytime after it finishes |
| Instant restore | Translated pages are cached locally — revisit one and the translation is restored instantly, no re-translation needed |
| Auto offer bar | Opening a foreign-language page shows a Google-style offer bar, with per-site “always translate” / “never ask” memory |
| Fast batched requests | Multiple segments are merged into one newline-aligned request (25 segments per request), making full-page translation ~10× faster |
| Quick translation | Type in the popup and translate instantly |

## Translation engines (automatic failover, all VPN-free)

The background tries the following free engines in order and **switches automatically** when one is rate-limited or unavailable:

| Order | Engine | Notes |
| --- | --- | --- |
| 1 | Youdao | Fast, supports newline batched requests; bursts may be rate-limited |
| 2 | DeepL | High quality, long texts, more languages; strict rate limits |
| 3 | MyMemory | Fallback engine that guarantees a result |

> Rate-limited engines enter a cooldown and the chain moves on automatically; failed items are retried once.

## Installation (3 steps, no store required)

1. Open `chrome://extensions` in Chrome
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** and select this repository folder (the one containing `manifest.json`)

> Also works on Edge: `edge://extensions` → Developer mode → Load unpacked.
> To translate local files (file:// HTML), enable “Allow access to file URLs” on the extension details page.

## Tips

- **Selection**: after selecting text, a blue “译” button appears above it; `Alt+T` works too.
- **Full page**: `Alt+P` toggles translate/restore; click “Show original” afterwards to compare anytime.
- **Auto restore**: can be turned off in the popup.
- **Shortcuts**: configure at `chrome://extensions/shortcuts`.
- **Popup “测试服务”**: one click to check the engine chain.

## Build from source

Clone the repo and load it as above (Manifest V3 — no dependencies, no build step).
To regenerate icons: `pip install pillow && python tools/gen_icons.py`.

## Project layout

```
jianyi-translate/
├─ manifest.json      Extension manifest (Manifest V3)
├─ background.js      Service worker: Youdao/DeepL/MyMemory dispatch (batching, cooldowns, failover, cache)
├─ content.js         In-page: selection bubble, full-page translate/restore, offer bar, site memory
├─ content.css        In-page UI styles
├─ popup.html/.js     Toolbar popup: quick translation, settings, page actions
├─ icons/             Icons
├─ tools/gen_icons.py Icon generator script
├─ .github/           CI: icon generation, tag-driven releases
├─ CONTRIBUTING.md    Contributing guide
├─ README.en.md       English readme
└─ README.md
```

## FAQ

- **Which pages can't be translated?** Browser-internal pages (`chrome://`, settings, new tab), Chrome Web Store and other protected pages cannot be injected; content rendered inside Shadow DOM is not covered yet.
- **Why the “read and change all your data on websites” permission?** Required by the Manifest V3 scripting API to inject the translation script. The extension only reads page text when you trigger a translation and collects nothing else.
- **Translation fails?** Free endpoints have quotas and burst limits; the extension already paces requests, switches engines and retries. Use the popup's “测试服务” to check the chain anytime.
- **Do Chinese pages get translated?** They are detected and skipped when the text is already the target language; Simplified/Traditional Chinese are still converted between each other.
- **Privacy**: only text you explicitly translate is sent to the corresponding engine (Youdao/DeepL/MyMemory). Translation caches live only in your browser's local storage and are never uploaded.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (in Chinese).

## Disclaimer

- This project is for learning and personal use only; do not use it commercially.
- It relies on free public endpoints (Youdao aidemo, DeepL web, MyMemory) — please respect their terms of service and avoid abuse.
- Use at your own risk.

## License

[MIT](LICENSE)

## Changelog

v1.3.0 · Google-style rework: translation-only default, auto offer bar + per-site memory, show original/translation toggle, Youdao newline batching (~10× faster full page), cache moved to the service worker
v1.2.1 · Auto restore retries with delays (0.5–7 s) for dynamically rendered pages; full-chain logging; bfcache re-apply
v1.2.0 · Local translation cache for instant restore on revisit (toggleable); unlimitedStorage permission
v1.1.5 · Page-level language hints, automatic retry of failed items, client-side language guessing
v1.1.4 · Added <all_urls> host permission (fixes re-injection on tabs opened before a reload)
v1.1.3 · Surface the exact injection failure reason
v1.1.2 · Popup page actions now routed through the service worker (auto re-injection); SW console diagnostics
v1.1.1 · Fixed stale content scripts not taking over after extension reload; badge feedback on injection failure
v1.1.0 · Multi-engine failover (Youdao → DeepL → MyMemory), fixes Microsoft auth 404
v1.0.0 · First release