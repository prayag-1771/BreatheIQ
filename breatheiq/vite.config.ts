import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the app works offline from one bundle (recharts + framer-motion ≈ 0.9 MB); MQTT and the map load on demand
  build: { chunkSizeWarningLimit: 1100 }, // the largest chunk is MapLibre, loaded only with the map
})
