# Keli

Keli is your AI assistant: boot agent profiles locally, run sessions from the terminal or the built-in browser UI, and extend everything with plugins.

Keli is a soft fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT-licensed), rebranded and extended with:

- **Keli account sign-in** — on first launch, and on any launch without a stored session, Keli prints a link you click to log in or sign up with your Keli account. Nothing runs until you are signed in.
- **OpenRouter, preconfigured** — the LLM provider is auto-configured to OpenRouter; paste your own OpenRouter API key once when prompted.
- **Server-controlled model allowlist** — the list of allowed models is served by Keli and refreshed on every launch. Today it contains exactly one model: `z-ai/glm-5.3-flash` (GLM 5.3 Flash).

## Quick start

From a repository checkout:

```sh
pnpm install
pnpm run build
pnpm keli web        # boots the web profile and opens the UI
```

From an installed package (once published):

```sh
npx @keli/cli web
```

The web UI serves on `http://127.0.0.1:3080`. Other profiles boot the same way: `keli --profile headless "answer one task"`, `keli --profile tui`, and so on. Run `keli --help` for the launcher's flags; every app prints its own help after the launcher flags.

## Keli account

Keli checks your authentication on every launch. When you are unauthenticated, it prints a one-time sign-in link, opens its local UI on a sign-in wall showing the same link, and starts nothing until you have signed in. Opening the link walks you through Keli account login or sign-up in your browser and hands the session back to the local app over loopback. The session is stored as `harness-auth.json` under the Keli home and revalidated (and rotated) on every launch.

Environment overrides:

- `KELI_WEB_URL` — the Keli web app the sign-in flow talks to (default `https://app.keli.ai`; point it at a local `app.keli.ai` checkout during development).
- `KELI_AUTH_DISABLED=1` — run without a Keli account. For upstream contributors and CI; the shipped product never sets it.

## Models

The LLM provider is preconfigured to **OpenRouter**; paste your API key once when the Models page asks (it lands in `~/.keli/.credentials.yaml`; an `OPENROUTER_API_KEY` in the environment or `~/.keli/.env` works too). The model list is not the OpenRouter catalog: it is the allowlist the Keli server delivers on every launch, and today it contains exactly one model — `z-ai/glm-5.3-flash` (GLM 5.3 Flash) — which every session defaults to.

## Configuration

Profiles, credentials, and caches live under the Keli home, `$KELI_HOME` (default `~/.keli`; the legacy `$DSH_HOME` spelling is still honored). See `apps/cli/reference/README.md` for the full profile and patch-layer reference inherited from upstream.

## Relationship to DeepSeek Harness

Keli is an independent project built on the open-source DeepSeek Harness codebase; it is not affiliated with, endorsed by, or sponsored by DeepSeek. "DeepSeek Harness" is a trademark of DeepSeek — this fork refers to it solely to describe its origin, per the upstream brand guidelines. The upstream architecture, plugin system, and documentation remain the best deep-dive reference for everything under `packages/`.

## License

MIT — see [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
