# NyaLingo

NyaHome 与 NyaReader 共用的翻译服务插件（Obsidian）。提供离线（MTranServer）与在线（OpenAI 兼容 / DeepL）翻译能力，配置只存一份，两插件通过 `app.plugins.getPlugin("nyalingo")` 调用。

> 独立插件，与 NyaHome / NyaReader 是不同插件，供它们共用一套翻译基础设施。

## 功能

- **离线翻译**（默认）：MTranServer，本地运行、隐私安全、无需联网
- **在线翻译**：OpenAI 兼容 API / DeepL
- **公共 API**：`translate()` / `healthCheck()` / `getConfig()` / `onSettingsChange()` / `testConnection()` / `openSetupWizard()` / `clearCache()`
- **翻译缓存**：LRU + 持久化，重复选中不重复请求
- **离线安装向导**：自动识别平台给出下载入口、一键打开下载页、填地址后一键测试连接

## 安装（本地部署）

把 `main.js`、`manifest.json`、`styles.css` 复制到：

```
<Vault>/.obsidian/plugins/nyalingo/
```

启用插件后，NyaHome / NyaReader 会自动通过公共 API 调用本插件。

## 翻译配置

打开 设置 → 第三方插件 → NyaLingo：

1. **离线翻译**（默认）：点「打开安装向导」→ 按步骤下载并启动 MTranServer → 回到设置填入地址（如 `http://127.0.0.1:8989`）→ 测试连接。
2. **在线翻译**：切换引擎为 OpenAI 兼容 / DeepL，填写地址、密钥、模型名称。
3. 默认中英互译（源语言 auto → 目标中文），可切换目标语言。

## 公共 API（供 NyaHome / NyaReader）

```ts
interface NyaLingoApi {
  translate(text: string, opts?: { from?: string; to?: string; html?: boolean }): Promise<string>;
  healthCheck(): Promise<boolean>;
  getConfig(): NyaLingoSettings;
  onSettingsChange(cb: (cfg: NyaLingoSettings) => void): () => void;
  testConnection(): Promise<{ ok: boolean; detail?: string }>;
  openSetupWizard(): void;
  clearCache(): Promise<void>;
}
// 调用示例：
const lingo = app.plugins.getPlugin("nyalingo");
const t = await lingo.translate("Hello world", { to: "zh-Hans" });
```

## 开发

```bash
npm install
npm run dev        # 监听构建
npm run build      # 类型检查 + 生产构建
npm test           # 运行 Vitest 单元测试
```

## 测试

29 个单元测试覆盖：三个 Provider（OpenAI/DeepL/MTranServer）请求构造与响应解析、翻译分块与合并、并发去重、LRU 缓存与持久化、设置归一化、离线引擎探测、HTML 转纯文本。

## 已知限制

- 仅桌面端（`isDesktopOnly: true`）。
