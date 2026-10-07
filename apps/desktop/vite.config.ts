import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// 构建时注入版本号（设置页诊断卡显示，确认真机装的是哪个包）
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/* 开发者构建开关：构建前 export ONETHU_DEV=1（见 tools/build-android-dev.sh、tools/build-desktop-dev.sh）。
 * 正式版不设该变量 → __ONETHU_DEV__ 折叠为 false，Layout/main.tsx 里所有 dev 分支（含动态
 * import）被 rollup 静态删除，dev 面板与日志桥整块不进产物。守卫：tools/devtools-test.mjs。 */
const DEV_BUILD = process.env.ONETHU_DEV === "1";

/** 编译时的最后 commit（工作区有未提交改动时带 -dirty）——右上角 dev 徽标显示的就是它 */
function gitCommit(): string {
  try {
    const cwd = new URL(".", import.meta.url);
    const run = (cmd: string): string =>
      execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const sha = run("git rev-parse --short HEAD");
    return run("git status --porcelain --untracked-files=no").length > 0 ? sha + "-dirty" : sha;
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __ONETHU_DEV__: JSON.stringify(DEV_BUILD),
    __ONETHU_COMMIT__: JSON.stringify(gitCommit()),
    __ONETHU_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  optimizeDeps: {
    // @onethu/core 是 workspace 源码包（零运行时依赖）：预打包会被 .vite/deps
    // 钉死在旧快照——外置 exFAT 卷上 deps 再优化不触发（2026-09-14 实锤：
    // served bundle 里 grep 不到 parseXkCatalogDom，教师列修复全没生效）。
    // exclude 让 core 永远走 /@fs 源码路径，改动即达 HMR。
    exclude: ["@onethu/core"],
  },
  resolve: {
    // react 双实例防火墙：pnpm workspace 下根 .pnpm 与 apps/desktop .pnpm 各有一份物理 react，
    // vite 预打包按路径各打一份 → react-quill 内部 hooks dispatcher 为 null（useState 读 null）
    // → 白屏（2026-09-02 实锤：两份产物源路径 ../../node_modules vs node_modules）。
    // dedupe 强制全部解析到单一实例。
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    // buffer 真实现：jspdf→fflate 的 browser 字段把 "buffer" 映射为 false →
    // 模块求值期读空对象的 .Buffer.prototype 直接炸 → 整包白屏（2026-09-16
    // dev2 真机实录）。alias 到 feross/buffer，浏览器语义完整。
    alias: [{ find: /^buffer$/, replacement: "buffer/" }],
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
