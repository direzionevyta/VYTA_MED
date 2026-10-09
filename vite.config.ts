import { VitePWA } from 'vite-plugin-pwa'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [VitePWA({ registerType: 'autoUpdate', manifest: { name: 'Soccorso Stadio', short_name: 'Soccorso', start_url: '/', display: 'standalone', background_color: '#0f172a', theme_color: '#0f172a', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }, workbox: { navigateFallback: '/index.html' } }), react()],
})
