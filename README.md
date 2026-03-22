# playwright-page-agent

Write Playwright E2E tests in plain English and let an [AI page agent](https://www.npmjs.com/package/page-agent) drive the browser. This package wires **Playwright Test**, a **Node-side LLM proxy** (no API key in the page), and the bundled **page-agent** UI runtime.

This repository is **public** for reference and transparency. **Published packages are not distributed as a public registry install**—how you obtain releases (private feed, internal tooling, tarball, or building here) is up to your organization.

## Requirements

- Node 18+ (or Bun)

## Install

Use whichever source your team uses for private artifacts. This README intentionally does **not** document a specific registry, scope, or URL.

### Option A — Build from this repository

```bash
git clone <repository-url>
cd playwright-page-agent
bun install
bun run build
```

Point your app at the checkout with a **file dependency**, **`npm link` / `bun link`**, or your monorepo workspace, then install peers in that app:

```bash
npm install @playwright/test page-agent
```

(Use the same package manager you use for the rest of the project.)

### Option B — Private package install

After your package manager is configured for your organization’s registry (per internal docs—`.npmrc`, tokens, etc.), install the package name defined in this repo’s `package.json` together with its **peer dependencies**:

```bash
npm install playwright-page-agent @playwright/test page-agent
```

Adjust the command for `pnpm` / `yarn` / `bun` as needed.

**Peers:** The in-browser page-agent UI is **bundled** inside this package (`dist/page-agent.js`). Peers exist so you share one Playwright install and TypeScript can resolve types such as `PageAgentConfig`. Your package manager may install missing peers automatically; if not, add `@playwright/test` and `page-agent` explicitly.

### Playwright browsers

```bash
npx playwright install
```

## Configuration

1. Copy `.env.example` to `.env` in your project (do not commit `.env`).
2. Set at least **`AGENT_API_KEY`** for your LLM provider.

| Variable           | Required | Description |
|--------------------|----------|-------------|
| `AGENT_API_KEY`    | Yes      | Provider API key (used only in Node for the proxy). |
| `AGENT_MODEL`      | No       | Defaults to `claude-haiku-4-5-20251001`. |
| `AGENT_BASE_URL`   | No       | Override API base URL; otherwise inferred from the model name. |

Load environment variables in your test process (for example `import 'dotenv/config'` at the top of `playwright.config.ts`, or set secrets in CI).

## Usage

Use the extended `test` fixture so every test gets an `agentPage` with the proxy route installed. Call `setupAgentPage` once per test (or in `beforeEach`) after navigation, then `run` with a natural-language task.

```ts
import { test, expect, setupAgentPage, run } from 'playwright-page-agent'

test('agent completes a flow', async ({ agentPage }) => {
  await setupAgentPage(agentPage, 'http://localhost:5173/')
  const result = await run(agentPage, 'Click the sign-in link and confirm the login form is visible.')
  expect(result.data).toContain('success')
})
```

### Custom options

`setupAgentPage` accepts `AgentOptions` (hooks, `instructions`, `customTools`, etc.) aligned with `page-agent`’s config, except `model`, `baseURL`, and `apiKey` are controlled by environment variables and the built-in proxy.

## How it works

- Requests from the page to a fixed internal base URL are intercepted in Playwright and forwarded from **Node** to the real provider with your API key.
- The in-page agent uses a placeholder API key; the secret never crosses into the browser context.

## Building from source

```bash
bun install
bun run build
```

Produces `dist/index.js` (library entry) and `dist/page-agent.js` (IIFE bundle injected into the page).

## Acknowledgments

This package stands on top of excellent open source projects:

| Project | Repository | Role here |
|--------|------------|-----------|
| **Playwright** | [microsoft/playwright](https://github.com/microsoft/playwright) | Test runner and browser automation (`@playwright/test`). |
| **page-agent** | [alibaba/page-agent](https://github.com/alibaba/page-agent) | In-page AI agent runtime ([docs / demo](https://alibaba.github.io/page-agent/)). |
| **Zod** | [colinhacks/zod](https://github.com/colinhacks/zod) | Schema helpers exposed in the page for custom tools (`window.z`). |
| **dotenv** | [motdotla/dotenv](https://github.com/motdotla/dotenv) | Optional `.env` loading in your Playwright / Node process. |

Build tooling used in this repo: [Vite](https://github.com/vitejs/vite), [tsup](https://github.com/egoist/tsup), and [TypeScript](https://github.com/microsoft/TypeScript).

## License

MIT. See [LICENSE](./LICENSE).
