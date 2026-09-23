/** 构建期常量（vite define 注入，声明见 src/globals.d.ts）。 */
export const APP_VERSION = __APP_VERSION__;
/** 是否开发者构建（ONETHU_DEV=1）。正式版恒 false。 */
export const DEV_BUILD = __ONETHU_DEV__;
/** 编译时的最后 commit，如 62b8f17 或 62b8f17-dirty（工作区有未提交改动） */
export const BUILD_COMMIT = __ONETHU_COMMIT__;
/** 编译时刻（ISO） */
export const BUILD_TIME = __ONETHU_BUILD_TIME__;
