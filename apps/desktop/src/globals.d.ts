/** 构建期注入的全局常量（vite define，见 vite.config.ts）。
 *  放全局声明文件是为了让消费点直接用裸标识符：rollup 拿到的是字面量，
 *  `if (__ONETHU_DEV__)` 才能被静态折叠掉（dev 代码整块不进正式版产物）。 */
declare const __APP_VERSION__: string;
declare const __ONETHU_DEV__: boolean;
declare const __ONETHU_COMMIT__: string;
declare const __ONETHU_BUILD_TIME__: string;
