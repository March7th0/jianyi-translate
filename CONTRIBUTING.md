# 贡献指南

感谢你对「简译 · jianyi-translate」的关注!欢迎以任何形式参与贡献:反馈问题、提出建议、改进文档或提交代码。

## 如何参与

- 🐛 **反馈问题**:提交 Issue。请附上:
  - 复现步骤与网页类型(普通网站 / 本地文件 / 浏览器内置页);
  - 两处控制台的 `[简译]` 日志:扩展详情页「检查视图 Service Worker」+ 网页自身 F12 控制台;
  - Chrome 版本与操作系统。
- 💡 **功能建议**:提交 Issue 并在标题前加 `[建议]`。
- 🔧 **提交代码**:Fork → 新建分支 → 提交 PR,流程见下。

## 开发环境

- **无需构建**:克隆仓库后,在 `chrome://extensions`(开发者模式)「加载已解压的扩展程序」选择本目录即可调试。
- 改动 `background.js` / `popup.*` 后,需在扩展管理页点击「刷新」;改动 `content.js` / `content.css` 后需刷新目标网页(扩展重载后旧页面会自动重新注入)。
- 调试入口:
  - 后台 Service Worker:扩展详情页 → 检查视图 Service Worker;
  - 内容脚本:目标网页 F12 → Console,关注 `[简译]` 前缀日志。
- 图标重新生成:`pip install pillow && python tools/gen_icons.py`(需含中文字体环境)。

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/):

| 前缀 | 用途 |
| --- | --- |
| `feat:` | 新功能 |
| `fix:` | 缺陷修复 |
| `docs:` | 文档 |
| `ci:` | CI / 工作流 |
| `refactor:` | 重构 |
| `chore:` | 杂项 |

示例:`feat: 支持鼠标悬停翻译段落`

## Pull Request 流程

1. Fork 本仓库并创建特性分支:`git checkout -b feat/your-feature`
2. 保持改动聚焦,一个 PR 只解决一件事
3. PR 描述写清三点:**动机**、**改动点**、**测试方式**(在哪些页面验证过)
4. 如改动影响用户可见行为,请同步更新 README 与「版本」小节
5. 等待维护者 review,按意见修改后 rebase

## 注意事项

- 引擎链使用的是各平台**免费公开接口**(有道 aidemo、DeepL web、MyMemory),请勿引入需要付费或申请 Key 的接口,请勿高频滥用(避免触发平台风控影响其他用户);
- 新增 Chrome 权限需在 README「常见问题」中说明理由,能不加就不加;
- 翻译缓存、站点偏好等用户数据只允许存放在本机(`chrome.storage`),禁止上传任何第三方;
- 页面内注入的 UI 请使用 `jy-` 前缀类名与 `#jy-layer-root` 容器,避免污染宿主页面样式。

## 行为准则

保持友善与尊重,对事不对人;讨论聚焦在技术与产品本身。