import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Browsers only allow camera access on secure origins. localhost counts as secure, but
  // testing on a phone over the local network needs HTTPS, so it can be switched on here.
  const devHttps = env.DEV_HTTPS === 'true'

  return {
    plugins: [react(), tailwindcss(), ...(devHttps ? [basicSsl()] : [])],
    server: {
      host: devHttps ? true : undefined,
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
