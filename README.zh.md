# Keli

Keli 是你的 AI 助手：在本地启动 agent profile、从终端或内置浏览器 UI 运行会话，并用插件扩展一切。

Keli 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT 许可）的软分叉（soft fork），在 其基础上重新命名并扩展了：

- **Keli 账号登录** —— 首次启动以及任何没有本地会话的启动时，Keli 会给出一个链接，点击即可登录或注册你的 Keli 账号；登录前不会运行任何内容。
- **预配置 OpenRouter** —— LLM 提供方自动配置为 OpenRouter，按提示粘贴你自己的 OpenRouter API key 即可。
- **服务端控制的模型白名单** —— 允许的模型列表由 Keli 服务端下发，并在每次启动时刷新。当前仅包含 `z-ai/glm-5.3-flash`（GLM 5.3 Flash）。

## 快速开始

```sh
pnpm install
pnpm run build
pnpm keli web
```

## 许可与归属

MIT —— 见 [LICENSE](./LICENSE) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。Keli 与 DeepSeek 无隶属或背书关系，仅按上游品牌指引描述其来源。
