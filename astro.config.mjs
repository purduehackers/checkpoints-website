import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // Dev only: one origin, like production. Elysia runs on :3000 (`bun dev`).
    server: { proxy: { '/api': { target: 'http://localhost:3000', ws: true } } },
  },
})
