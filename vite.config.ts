import { defineConfig } from 'vite'

export default defineConfig({
	build: {
		lib: {
			entry: './src/entry.ts',
			name: 'PageAgentBundle',
			formats: ['iife'],
			fileName: () => 'page-agent.js',
		},
		outDir: 'dist',
		emptyOutDir: true,
	},
})
