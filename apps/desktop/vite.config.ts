import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// 构建时注入版本号（设置页诊断卡显示，确认真机装的是哪个包）
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  resolve: {
    // react 双实例防火墙：pnpm workspace 下根 .pnpm 与 apps/desktop .pnpm 各有一份物理 react，
    // vite 预打包按路径各打一份 → react-quill 内部 hooks dispatcher 为 null（useState 读 null）
    // → 白屏（2026-09-02 实锤：两份产物源路径 ../../node_modules vs node_modules）。
    // dedupe 强制全部解析到单一实例。
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
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
