import { expect, test as base, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import type { PageAgentConfig } from 'page-agent'
import { handleProxyRoute, PROXY_INTERCEPT_URL, type ProxyConfig } from './proxy'

const PAGE_AGENT_SCRIPT = readFileSync(
	fileURLToPath(new URL('../dist/page-agent.js', import.meta.url)),
	'utf-8',
)

const PROXY_CONFIG: ProxyConfig = {
	model: process.env.AGENT_MODEL ?? 'claude-haiku-4-5-20251001',
	baseURL: process.env.AGENT_BASE_URL,
	apiKey: process.env.AGENT_API_KEY ?? '',
}

type OnBeforeStepParams = Parameters<NonNullable<PageAgentConfig['onBeforeStep']>>
type OnAfterStepParams = Parameters<NonNullable<PageAgentConfig['onAfterStep']>>
type OnBeforeTaskParams = Parameters<NonNullable<PageAgentConfig['onBeforeTask']>>
type OnAfterTaskParams = Parameters<NonNullable<PageAgentConfig['onAfterTask']>>
type OnDisposeParams = Parameters<NonNullable<PageAgentConfig['onDispose']>>

// Custom tool type without Zod — the schema is built in the browser via window.z.
export interface CustomTool {
	description?: string
	execute: (args: unknown) => Promise<unknown>
}

export interface AgentOptions extends Omit<
	PageAgentConfig,
	'model' | 'baseURL' | 'apiKey' | 'customFetch' | 'transformPageContent' | 'customTools' | 'instructions'
> {
	transformPageContent?: (content: string) => Promise<string> | string
	customTools?: Record<string, CustomTool | null>
	instructions?: {
		system?: string
		getPageInstructions?: (url: string) => string | undefined | null
	}
}

// Shape passed into page.evaluate — all values must be JSON-serialisable.
type EvalArg = readonly [
	proxyBaseURL: string,
	model: string,
	serializable: Record<string, unknown>,
	serializableInstr: Record<string, unknown>,
	hooks: Record<string, boolean>,
	tools: Record<string, { description?: string } | null>,
]

export const test = base.extend<{ agentPage: Page }>({
	agentPage: async ({ page }, use) => {
		if (!PROXY_CONFIG.apiKey)
			throw new Error(
				'AGENT_API_KEY is not set. Copy .env.example to .env, set AGENT_API_KEY, and load env in your test runner (e.g. dotenv/config or CI secrets).',
			)
		await page.route(`${PROXY_INTERCEPT_URL}/**`, (route) => handleProxyRoute(route, PROXY_CONFIG))
		await use(page)
	},
})

export { expect }

export async function setupAgentPage(page: Page, path: string, options: AgentOptions = {}) {
	const {
		onBeforeStep,
		onAfterStep,
		onBeforeTask,
		onAfterTask,
		onDispose,
		transformPageContent,
		instructions,
		customTools,
		...serializableOptions
	} = options

	const { getPageInstructions, ...serializableInstructions } = instructions ?? {}

	// Expose function-based options from Node.js so the browser can call them via exposeFunction.
	// The agent param is not serialisable across the boundary — the browser passes undefined in its place.
	if (onBeforeStep)
		await page.exposeFunction('__pa_onBeforeStep', (...args: OnBeforeStepParams) => onBeforeStep(...args))
	if (onAfterStep)
		await page.exposeFunction('__pa_onAfterStep', (...args: OnAfterStepParams) => onAfterStep(...args))
	if (onBeforeTask)
		await page.exposeFunction('__pa_onBeforeTask', (...args: OnBeforeTaskParams) => onBeforeTask(...args))
	if (onAfterTask)
		await page.exposeFunction('__pa_onAfterTask', (...args: OnAfterTaskParams) => onAfterTask(...args))
	if (onDispose)
		await page.exposeFunction('__pa_onDispose', (...args: OnDisposeParams) => onDispose(...args))
	if (transformPageContent)
		await page.exposeFunction('__pa_transformPageContent', transformPageContent)
	if (getPageInstructions)
		await page.exposeFunction('__pa_getPageInstructions', getPageInstructions)

	// Expose each custom tool's execute function. The Zod schema is built in the
	// browser via window.z (exposed by page-agent.entry.ts).
	const toolDefs: Record<string, { description?: string } | null> = {}
	for (const [name, tool] of Object.entries(customTools ?? {})) {
		if (tool === null) { toolDefs[name] = null; continue }
		await page.exposeFunction(`__pa_tool_${name}`, tool.execute)
		toolDefs[name] = { description: tool.description }
	}

	await page.goto(path)
	await page.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0)
	await page.addScriptTag({ content: PAGE_AGENT_SCRIPT })

	await page.evaluate<void, EvalArg>(
		([proxyBaseURL, model, serializable, serializableInstr, hooks, tools]) => {
			const w = window as unknown as Record<string, CallableFunction>
			const config: Record<string, unknown> = {
				model,
				baseURL: proxyBaseURL,
				apiKey: 'unused',
				maxRetries: 5,
				enableMask: false,
				...serializable,
				instructions: Object.keys(serializableInstr).length ? serializableInstr : undefined,
			}

			if (hooks['onBeforeStep']) config['onBeforeStep'] = (...args: OnBeforeStepParams) => w.__pa_onBeforeStep(...args)
			if (hooks['onAfterStep']) config['onAfterStep'] = (...args: OnAfterStepParams) => w.__pa_onAfterStep(...args)
			if (hooks['onBeforeTask']) config['onBeforeTask'] = (...args: OnBeforeTaskParams) => w.__pa_onBeforeTask(...args)
			if (hooks['onAfterTask']) config['onAfterTask'] = (...args: OnAfterTaskParams) => w.__pa_onAfterTask(...args)
			if (hooks['onDispose']) config['onDispose'] = (...args: OnDisposeParams) => w.__pa_onDispose(...args)
			if (hooks['transformPageContent']) config['transformPageContent'] = (c: string) => w.__pa_transformPageContent(c)
			if (hooks['getPageInstructions']) {
				config['instructions'] = {
					...(config['instructions'] as object),
					getPageInstructions: (url: string) => w.__pa_getPageInstructions(url),
				}
			}

			if (Object.keys(tools).length) {
				const customTools: Record<string, unknown> = {}
				for (const [name, def] of Object.entries(tools)) {
					customTools[name] = def === null ? null : {
						description: def.description,
						inputSchema: w.z(),
						execute: (args: unknown) => w[`__pa_tool_${name}`](args),
					}
				}
				config['customTools'] = customTools
			}

			const agent = new window.PageAgent(config as unknown as ConstructorParameters<typeof window.PageAgent>[0])
			agent.panel.hide()
			window.pageAgent = agent
		},
		[
			PROXY_INTERCEPT_URL,
			PROXY_CONFIG.model,
			serializableOptions as Record<string, unknown>,
			serializableInstructions as Record<string, unknown>,
			{
				onBeforeStep: !!onBeforeStep,
				onAfterStep: !!onAfterStep,
				onBeforeTask: !!onBeforeTask,
				onAfterTask: !!onAfterTask,
				onDispose: !!onDispose,
				transformPageContent: !!transformPageContent,
				getPageInstructions: !!getPageInstructions,
			},
			toolDefs,
		],
	)
}

export async function run(page: Page, task: string) {
	const result = await page.evaluate((t) => window.pageAgent.execute(t), task)
	const info = base.info()
	info.attachments.push({ name: 'Agent verdict', contentType: 'text/plain', body: Buffer.from(result.data) })
	return result
}
