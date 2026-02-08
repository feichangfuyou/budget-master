import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Instant HMR — ensure changes are picked up immediately
    watch: {
      usePolling: true, // Works on all file systems (VM, NFS, Docker, etc.)
      interval: 100,   // Check for changes every 100ms
    },
    hmr: {
      overlay: true,   // Show errors in overlay
    },
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
