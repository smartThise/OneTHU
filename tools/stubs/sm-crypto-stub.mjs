/** 国密库的测试替身（仅供会话逻辑测试加载模块图用）。
 *
 *  为什么需要：learn 客户端的模块图会经 crypto/sm2 引到 CJS 包 sm-crypto，
 *  而 Node 直跑 TS 源码时无法静态识别它的具名导出 → 模块图根本加载不起来，
 *  行为测试就只能退回「读源码断言」。
 *
 *  替身只保证「加载得起来」：真被调用一律抛错。会话测试不该碰国密，宁可当场炸，
 *  也不要让假实现替真实现背书。
 */
const notUsed = (name) => () => {
  throw new Error(`sm-crypto 替身：测试里调用了 ${name}（这条路径不该碰国密）`);
};
export const sm2 = new Proxy({}, { get: (_t, p) => notUsed(`sm2.${String(p)}`) });
export const sm3 = notUsed("sm3");
export const sm4 = new Proxy({}, { get: (_t, p) => notUsed(`sm4.${String(p)}`) });
