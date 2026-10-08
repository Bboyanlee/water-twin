import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `vite build --mode static`（npm run build:static）→ GitHub Pages 靜態版：
// 相對路徑（網站位於 /<repo>/ 子路徑），.env.static 設定 VITE_STATIC=1 讓前端改讀 public/data 的預先匯出資料。
export default defineConfig(({ mode }) => ({
  base: mode === 'static' ? './' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          echarts: ['echarts', 'echarts-for-react'],
        },
      },
    },
  },
}));
