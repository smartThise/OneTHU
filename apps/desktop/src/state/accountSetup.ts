/**
 * 首启导览的账号接入步骤（R21b，用户定案 2026-09-21）：雨课堂 / OJ / 邮箱日历 / 云盘。
 *
 * 纪律：这里只做**组合**，不复制实现——登录与落库全部走设置页同一套 state 模块
 * （exthw / cloudCal / seafile），保证导览里填的凭据与设置页读写同一份，语义不分叉。
 * 「看情况」的分支（如 webview 登录仅 Android 可用）由 UI 层按既有开关决定，
 * 本模块只提供动作与状态。
 */
import { ensureExtHwCredsLoaded, extHwLogin, getExtHwCreds, refreshExtHw, saveExtHwCreds } from "./exthw.js";
import { configureCloudCal, ensureCloudCalLoaded, getCloudCalConfig } from "./cloudCal.js";
import { ensureSeafileLoaded, getSeafileToken, setSeafileToken } from "./seafile.js";

export interface AccountStatus {
  yuketang: boolean;
  tyche: boolean;
  dsa: boolean;
  mail: boolean;
  cloud: boolean;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 100);

/** 读当前接入状态（同步；须先 ensureAccountStatusLoaded 才可信） */
export function readAccountStatus(): AccountStatus {
  const c = getExtHwCreds();
  return {
    yuketang: Boolean(c.yuketang?.cookie?.trim()),
    tyche: Boolean(c.tyche?.cookie?.trim()),
    dsa: Boolean(c.dsa?.cookie?.trim()),
    mail: Boolean(getCloudCalConfig()),
    cloud: Boolean(getSeafileToken()),
  };
}

/** 导览打开时加载一次（凭据信封解密 + 各模块缓存）；失败按未配置处理 */
export async function ensureAccountStatusLoaded(): Promise<AccountStatus> {
  try {
    await ensureExtHwCredsLoaded();
  } catch {
    /* 无凭据或未解锁：按未配置展示 */
  }
  try {
    await ensureCloudCalLoaded();
  } catch {
    /* ignore */
  }
  try {
    await ensureSeafileLoaded();
  } catch {
    /* ignore */
  }
  return readAccountStatus();
}

/** 雨课堂：扫码 / 官方网页登录成功后落库（与设置页同一路径） */
export async function connectYuketang(cookie: string): Promise<AccountStatus> {
  await saveExtHwCreds({ ...getExtHwCreds(), yuketang: { cookie } });
  void refreshExtHw();
  return readAccountStatus();
}

/** Tyche OJ：账号密码登录并保存会话 */
export async function loginTyche(user: string, pwd: string): Promise<AccountStatus> {
  const u = user.trim();
  if (!u || !pwd) throw new Error("请输入账号与密码");
  const r = await extHwLogin.tyche(u, pwd);
  await saveExtHwCreds({ ...getExtHwCreds(), tyche: { cookie: r.cookie, username: u } });
  void refreshExtHw();
  return readAccountStatus();
}

/** DSA OJ：账号密码登录并保存会话 */
export async function loginDsa(user: string, pwd: string): Promise<AccountStatus> {
  const u = user.trim();
  if (!u || !pwd) throw new Error("请输入账号与密码");
  const r = await extHwLogin.dsa(u, pwd);
  await saveExtHwCreds({ ...getExtHwCreds(), dsa: { cookie: r.cookie, username: u } });
  void refreshExtHw();
  return readAccountStatus();
}

/** 邮箱日历（CalDAV）：完整邮箱 + 客户端专用密码 */
export async function connectMail(email: string, authCode: string): Promise<AccountStatus> {
  if (!email.trim() || !authCode) throw new Error("请输入邮箱与客户端专用密码");
  await configureCloudCal(email.trim(), authCode);
  return readAccountStatus();
}

/** 清华云盘：Web API Auth Token（setSeafileToken 会实际校验并返回账户信息） */
export async function connectCloudDisk(token: string): Promise<AccountStatus> {
  if (!token.trim()) throw new Error("请先填入云盘网页端生成的访问口令");
  await setSeafileToken(token.trim());
  return readAccountStatus();
}

export { errMsg as accountErrMsg };
