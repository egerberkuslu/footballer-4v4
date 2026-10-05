import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// GitHub Pages alt yolda servis eder (https://kullanici.github.io/depo/): göreli base
export default defineConfig({
  base: './',
  plugins: [react()],
})
