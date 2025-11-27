import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    define: {
      // Critical: Polyfill process.env.API_KEY so it works in the browser
      // and during production builds on Vercel/Netlify.
      // Now supports GEMINI_API_KEY, VITE_API_KEY, or API_KEY.
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.VITE_API_KEY || env.GEMINI_API_KEY || '')
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    server: {
      host: true, // Enables network access (IP exposure)
      port: 5173,
    }
  }
})
