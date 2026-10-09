import { VitePWA } from 'vite-plugin-pwa'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [VitePWA({ registerType: 'autoUpdate', manifest: { name: 'VYTA MED', short_name: 'VYTA', lang: 'it', start_url: '/', display: 'standalone', background_color: '#142432', theme_color: '#142432', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/apple-touch-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] }, workbox: { navigateFallback: '/index.html' } }), react()],
})
