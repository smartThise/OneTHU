import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    watch: {
      // exFAT 卷 inotify 不可靠：不开轮询则 HMR 不推送，窗口永远停在旧渲染
      usePolling: true,
      interval: 300,
    },
  },
});
