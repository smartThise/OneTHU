/**
 * ESM 扩展名兜底 resolve 钩子。
 *
 * 有些 npm 包（如 @material/material-color-utilities 0.4.0）是 ESM 但内部相对导入不写 .js——
 * 打包器（Vite）能解析，Node 的严格 ESM 解析不能，直接 ERR_MODULE_NOT_FOUND。
 * 这里在解析失败时补 .js / /index.js 再试一次，避免为一个构建期脚本引入打包器依赖。
 *
 * 用法：node --import ./tools/ext-resolve.mjs <script>
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e && e.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) {
      for (const suffix of [".js", "/index.js", ".mjs", "/index.mjs"]) {
        try {
          return await next(specifier + suffix, context);
        } catch {
          /* 继续试下一个后缀 */
        }
      }
    }
    throw e;
  }
}
