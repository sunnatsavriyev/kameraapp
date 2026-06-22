import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_BASE_URL || 'http://88.88.0.151:8090'

  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_DEV_PORT || '5173', 10),
      host: env.VITE_DEV_HOST || 'localhost',
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
