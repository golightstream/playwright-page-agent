/**
 * Standalone LLM proxy for Playwright tests.
 *
 * Accepts the same config as PageAgent. Intercepts page-agent's OpenAI-format
 * requests, reverses model-specific patches that page-agent applied internally,
 * and forwards to the correct provider endpoint — all from Node.js (no CORS).
 */
import type { Route } from '@playwright/test'

export interface ProxyConfig {
	model: string
	baseURL?: string        // optional: auto-derived from model prefix if omitted
	apiKey: string
	temperature?: number
	maxRetries?: number
	disableNamedToolChoice?: boolean
}

const MODEL_BASE_URLS: Record<string, string> = {
	claude: 'https://api.anthropic.com/v1',
	gpt: 'https://api.openai.com/v1',
	'gpt-5': 'https://api.openai.com/v1',
	gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
	grok: 'https://api.x.ai/v1',
	qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	minimax: 'https://api.minimax.chat/v1',
}

function normalizeModelName(model: string): string {
	let name = model.toLowerCase()
	if (name.includes('/')) name = name.split('/')[1]
	return name.replace(/_/g, '').replace(/\./g, '')
}

function resolveBaseURL(config: ProxyConfig): string {
	if (config.baseURL) return config.baseURL
	const normalized = normalizeModelName(config.model)
	for (const [prefix, url] of Object.entries(MODEL_BASE_URLS)) {
		if (normalized.startsWith(prefix)) return url
	}
	throw new Error(`[proxy] Cannot determine baseURL for model "${config.model}". Pass baseURL explicitly.`)
}

// ---------------------------------------------------------------------------
// Reverse the patches page-agent applied before sending to our proxy.
// page-agent's modelPatch() converts to provider-native format, but the
// OpenAI-compatible endpoints expect the original OpenAI format.
// ---------------------------------------------------------------------------

function reversePatch(body: Record<string, unknown>, normalized: string): void {
	if (normalized.startsWith('claude')) {
		delete body.thinking
		const tc = body.tool_choice as any
		if (tc?.type === 'any') {
			body.tool_choice = 'required'
		} else if (tc?.type === 'tool' && tc?.name) {
			body.tool_choice = { type: 'function', function: { name: tc.name } }
		}
	}

	if (normalized.startsWith('grok')) {
		delete body.thinking
		delete body.reasoning
	}
}

const PROXY_INTERCEPT_URL = 'https://agent-proxy.internal'

export async function handleProxyRoute(route: Route, config: ProxyConfig): Promise<void> {
	const baseURL = resolveBaseURL(config)
	const url = route.request().url().replace(PROXY_INTERCEPT_URL, baseURL)

	const body = JSON.parse(route.request().postData() ?? '{}')
	reversePatch(body, normalizeModelName(config.model))

	const response = await fetch(url, {
		method: route.request().method(),
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify(body),
	})

	if (!response.ok) {
		throw new Error(`[proxy] LLM API error ${response.status}: ${await response.text()}`)
	}

	await route.fulfill({
		status: response.status,
		contentType: 'application/json',
		body: Buffer.from(await response.arrayBuffer()),
	})
}

export { PROXY_INTERCEPT_URL }
