/// <reference types="vite/client" />

import type { PageAgent } from 'page-agent'
import type * as z from 'zod/v4'

declare global {
	interface Window {
		PageAgent: typeof PageAgent
		pageAgent: InstanceType<typeof PageAgent>
		z: typeof z
	}
}
