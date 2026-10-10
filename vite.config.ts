import { VitePWA } from 'vite-plugin-pwa'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.VITE_DEMO_MODE === 'true') {
    const demoRef = env.VITE_DEMO_SUPABASE_REF
    const productionRef = env.VITE_PRODUCTION_SUPABASE_REF
    const actualRef = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0] : ''
    if (!demoRef || !productionRef || demoRef === productionRef || demoRef !== actualRef) {
      throw new Error('Build demo bloccata: configura URL e riferimento di un progetto Supabase demo distinto dalla produzione.')
    }
  }

  return {
    plugins: [VitePWA({ registerType: 'autoUpdate', manifest: { name: 'VYTA MED', short_name: 'VYTA', lang: 'it', start_url: '/', display: 'standalone', background_color: '#142432', theme_color: '#142432', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/apple-touch-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] }, workbox: { navigateFallback: '/index.html' } }), react()],
  }
})
