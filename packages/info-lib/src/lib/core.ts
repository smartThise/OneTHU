import {
    CHECK_CURRENT_DEVICE_URL,
    CR_LOGIN_HOME_URL,
    DELETE_DEVICE_URL,
    DOUBLE_AUTH_URL,
    GET_COOKIE_URL,
    GET_DEVICE_LIST_URL,
    GITLAB_AUTH_URL,
    GITLAB_LOGIN_URL,
    ID_BASE_URL,
    ID_HOST_URL,
    ID_LOGIN_URL,
    ID_WEBSITE_BASE_URL,
    ID_WEBSITE_LOGIN_URL,
    INVOICE_LOGIN_URL,
    LOGIN_URL,
    LOGOUT_URL,
    MADMODEL_AUTH_LOGIN_URL,
    ROAMING_URL,
    SAVE_FINGER_URL,
    USER_DATA_URL,
    WEB_VPN_OAUTH_LOGIN_URL,
} from "../constants/strings";
import * as cheerio from "cheerio";
import {InfoHelper} from "../index";
import {clearCookies, getRedirectUrl, platformFetchWith, ResponseStatusError, stringify, uFetch} from "../utils/network";
import {IdAuthError, LibError, LoginError, LoginPreparationError, UrlError} from "../utils/error";
import {sm2} from "sm-crypto";

// OneTHU 适配：OpenHarmony rtn-network-utils require 块已剔除（vite 静态解析会失败）
let getRedirectLocation: ((url: string) => Promise<string | null | undefined>) | undefined = undefined;

type RoamingPolicy = "default" | "id" | "id_website" | "card" | "cab" | "gitlab" | "cr";

const HOST_MAP: { [key: string]: string } = {
    "zhjw.cic": "77726476706e69737468656265737421eaff4b8b69336153301c9aa596522b20bc86e6e559a9b290",
    "jxgl.cic": "77726476706e69737468656265737421faef469069336153301c9aa596522b20e33c1eb39606919f",
    "zhjwxk.cic": "77726476706e69737468656265737421faef469069336153301c9aa596522b20e33c1eb39606919f",
    "ecard": "77726476706e69737468656265737421f5f4408e237e7c4377068ea48d546d303341e9882a",
    "learn": "77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc",
    "mails": "77726476706e69737468656265737421fdf64890347e7c4377068ea48d546d3011ff591d40",
    "50": "77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00",
    "166.111.14.8": "77726476706e69737468656265737421a1a117d27661391e2f5cc7f4",
    "fa-online": "77726476706e69737468656265737421f6f60c93293c615e7b469dbf915b243daf0f96e17deaf447b4",
    "dzpj": "77726476706e69737468656265737421f4ed519669247b59700f81b9991b2631aee63c51",
    "jjhyhdf": "77726476706e69737468656265737421fafd49852f346e1e6a1b80a29f5d36342bb9c40cf69277",
    "yhdf": "77726476706e69737468656265737421e9ff459a69247b59700f81b9991b26317dbd36ae",
    "usereg": "77726476706e69737468656265737421e5e4448e223726446d0187ab9040227b54b6c80fcd73",
    "thos": "77726476706e69737468656265737421e4ff4e8f69247b59700f81b9991b2631ca359dd4",
    "zzjl.graduate": "77726476706e69737468656265737421eaed4b9069377a517a1d88b89d1b37269c624d2b1c6925f37faea82b8d",
    "madmodel.cs": "77726476706e69737468656265737421fdf6459128346d5c300b9ae28c462a3b27469fc32211fa26a3e464",
};

const SM2_MAGIC_NUMBER = "04";

const parseUrl = (urlIn: string) => {
    const rawRes = /http:\/\/(\d+.\d+.\d+.\d+):(\d+)\/(.+)/g.exec(urlIn);
    if (rawRes !== null && rawRes[1] !== undefined && rawRes[2] !== undefined && rawRes[3] !== undefined) {
        return `https://webvpn.tsinghua.edu.cn/http-${rawRes[2]}/${HOST_MAP[rawRes[1]]}/${rawRes[3]}`;
    }
    const protocol = urlIn.substring(0, urlIn.indexOf(":"));
    const regRes = /:\/\/(.+?).tsinghua.edu.cn(:(\d+))?\/(.+)/.exec(urlIn);
    if (regRes === null || regRes[1] === undefined || regRes[4] === undefined) {
        throw new UrlError();
    }
    const host = regRes[1];
    const protocolFull = regRes[3] === undefined ? protocol : `${protocol}-${regRes[3]}`;
    const path = regRes[4];
    return `https://webvpn.tsinghua.edu.cn/${protocolFull}/${HOST_MAP[host]}/${path}`;
};

const getWebVPNUrl = (urlIn: string): string => {
    if (urlIn.search("oauth.tsinghua.edu.cn") !== -1) {
        return urlIn;
    }

    const url = new URL(urlIn);
    const scheme = url.protocol.replace(":", "");
    const host = url.hostname;
    const port = url.port || (scheme == "https" ? "443" : "80");
    const uri = url.pathname + (url.search ? url.search : "") + (url.hash ? url.hash : "");
    return `https://oauth.tsinghua.edu.cn/lb-auth/lbredirect?scheme=${scheme}&host=${host}&port=${port}&uri=${uri}`;
};

export const getCsrfToken = async () => {
    const cookie = await uFetch(GET_COOKIE_URL);
    const q = /XSRF-TOKEN=(.+?);/.exec(cookie + ";");
    if (q === null || q[1] === undefined) {
        if (isConfirmedLoginPage(cookie)) {
            throw Object.assign(new IdAuthError("The university session requires sign-in."), {code: "AUTH_SESSION_EXPIRED"});
        }
        throw new Error("Failed to get csrf token.");
    }
    return q[1];
};

/** Positive login markers only. A gateway shell, missing token or malformed
 * JSON cannot establish that the user's credentials need resubmission. */
function isConfirmedLoginPage(html: string): boolean {
    const $ = cheerio.load(html);
    if ($("#sm2publicKey, input[name='i_pass'], input[name='password'], input[type='password']").length) return true;
    return $("a[href], form[action]").toArray().some((element) => {
        const target = $(element).attr("href") ?? $(element).attr("action");
        if (!target) return false;
        try {
            const url = new URL(target, WEB_VPN_OAUTH_LOGIN_URL);
            return url.protocol === "https:" && !url.username && !url.password && !url.port
                && ((url.hostname === "id.tsinghua.edu.cn" && url.pathname.startsWith("/do/off/ui/auth/login/form/"))
                    || (url.hostname === "webvpn.tsinghua.edu.cn" && url.pathname === "/login"));
        } catch { return false; }
    });
}

/**
 * 【移植自上游 v3.19.0（授权源码 thu-info-app，2026-10-04 发布）】
 * Builds the credential `POST` body for the unified ID system.
 *
 * `scheme` selects the field names: `/do/off/ui/auth/login/check` expects
 * `i_user` / `i_pass`, while `/security_check` (the `id_website` policy) expects
 * `username` / `password`. The upstream login form also carries the "trusted
 * browser" checkbox `singleLogin`（本次登录使用信任浏览器访问校内其他系统时
 * 不必再输入账号密码）, which makes the resulting ID session reusable by other
 * campus systems without a password（see passwordlessEntry）. This session SSO
 * option requires explicit consent; routine sign-in/roaming keeps the existing
 * fingerprint and trust token without automatically selecting the checkbox.
 */
export const __idCredentialFormForTest = async (
    helper: InfoHelper,
    publicKey: string,
    password: string,
    scheme: "i_user" | "username",
): Promise<{ [key: string]: string }> => {
    const form: { [key: string]: string } = {
        [scheme === "i_user" ? "i_user" : "username"]: helper.userId,
        [scheme === "i_user" ? "i_pass" : "password"]: SM2_MAGIC_NUMBER + sm2.doEncrypt(password, publicKey),
        fingerPrint: helper.fingerprint,
        fingerGenPrint: helper.fingerGenPrint ?? "",
        i_captcha: "",
    };
    if (helper.trustBrowser && helper.singleSignOn === true) {
        form.singleLogin = "on";
        form.deviceName = await helper.trustFingerprintNameHook();
    }
    return form;
};

type LoginPreparationStage = "credential-entry" | "trusted-confirmation";

function visibleAuthText(html: string): string {
    const $ = cheerio.load(html);
    $("script, style, template, noscript, [hidden], [aria-hidden='true']").remove();
    return ($("#msg_note").text().trim() || $("body").text()).replace(/\s+/g, " ").trim();
}

function preparationFailure(html: string, stage: LoginPreparationStage): LoginPreparationError {
    const text = visibleAuthText(html);
    const trust = /信任|受信|认证因子|验证因子|设备|trusted|trust|device|factor/i;
    const limit = /上限|过多|最大|已满|超出|超过|too many|maximum|limit|exceed/i;
    if (trust.test(text) && limit.test(text)) return new LoginPreparationError("trust-limit", stage);
    if (/访问过于频繁|请求过于频繁|访问受限|禁止访问|too many requests|access denied|temporarily blocked/i.test(text)) {
        return new LoginPreparationError("access-restricted", stage);
    }
    if (!html.trim()) return new LoginPreparationError("empty-response", stage);
    const $ = cheerio.load(html);
    // Wengine also injects these scripts into valid pages. Only classify its
    // small, form-free shell; never evaluate its scripts or follow body URLs.
    const hasAuthForm = $("input[type='password'], input[name='i_pass'], input[name='password'], #sm2publicKey, form[action*='checkSingle'], form[action*='security_check']").length > 0;
    const gatewayShell = html.length < 4000 && html.includes("__vpn_hostname_data")
        && html.includes("__vpn_app_hostname_data") && !hasAuthForm;
    const serverError = /^(?:503 Service Unavailable|502 Bad Gateway|504 Gateway Time-out|HTTP Status [45]\d\d|Error report)/i.test($("title").text().trim())
        || /^(?:502 Bad Gateway|503 Service Unavailable|504 Gateway Time-out)$/i.test($("h1").first().text().trim());
    if (!hasAuthForm && (gatewayShell || serverError)) return new LoginPreparationError("gateway-unavailable", stage);
    return new LoginPreparationError(
        $("input[name='i_pass'], input[name='password'], #sm2publicKey").length ? "missing-public-key" : "unexpected-page",
        stage,
    );
}

function loginPublicKey(html: string, stage: LoginPreparationStage): string | null {
    const keyElement = cheerio.load(html)("#sm2publicKey");
    const key = (keyElement.text().trim() || keyElement.attr("value") || "").trim();
    if (!key) return null;
    // Standard uncompressed SM2 keys and compressed points supported by sm-crypto.
    // Reject page markup/script snippets before the encryption library sees them.
    let valid = false;
    if (/^(?:04[\da-f]{128}|0[23][\da-f]{64})$/i.test(key)) {
        try { valid = sm2.verifyPublicKey(key); } catch { /* Invalid curve point. */ }
    }
    if (!valid) throw new LoginPreparationError("invalid-public-key", stage);
    return key;
}

function isTwoFactorPage(html: string): boolean {
    const $ = cheerio.load(html);
    // The university's React 2FA shell can have an empty body: its only
    // server-rendered marker is <title>二次认证</title>. Do not look inside
    // scripts (the password page also loads shared doubleauth assets).
    if ($("input[type='password'], input[name='i_pass'], input[name='password'], #sm2publicKey").length) return false;
    const note = $("#msg_note").text().trim();
    // An explicit school rejection must not be overridden by a page title.
    if (note && !note.includes("二次认证")) return false;
    return $("head > title").text().includes("二次认证") || visibleAuthText(html).includes("二次认证");
}

function isFinishedIdEntry(html: string, scheme: "i_user" | "username"): boolean {
    const text = visibleAuthText(html);
    if (isTwoFactorPage(html)) return true;
    if (scheme === "username") {
        return text.includes("账号设置") && !cheerio.load(html)("input[type='password'], input[name='password']").length;
    }
    return text.includes("登录成功。正在重定向到") && !!cheerio.load(html)("a[href]").length;
}

/** Whether a page can drive idLoginResponse instead of being a gateway detour.
 *  A live WebVPN session makes `/login?oauth_login=true` answer with the portal
 *  (no credential form), which must not be reported as a fatal unexpected page. */
function isUsableLoginEntry(html: string, scheme: "i_user" | "username"): boolean {
    if (isFinishedIdEntry(html, scheme) || isTwoFactorPage(html)) return true;
    const $ = cheerio.load(html);
    return !!($("#sm2publicKey").text().trim() || $("#sm2publicKey").attr("value")?.trim()
        || $("input[type='password'], input[name='i_pass'], input[name='password']").length);
}

/** A live WebVPN gateway answers the OAuth entry with its own portal/guide page.
 *  Only that page justifies a gateway reset; unrelated failures keep their
 *  existing classification and never trigger extra authentication traffic. */
function isWebVpnGatewayPage(html: string): boolean {
    return html.includes("__vpn_") || /wengine|webvpn|wrdvpn|show_vpn/i.test(html);
}

/** A still-authenticated WebVPN gateway answers the OAuth entry with its portal,
 *  so a saved password could never re-authenticate. End that gateway session and
 *  retry once; the public ID form remains reachable without WebVPN if the gateway
 *  still detours. Never log response bodies, cookies or session URLs here. */
const recoverLoginEntry = async (entryHtml: string): Promise<string> => {
    if (isUsableLoginEntry(entryHtml, "i_user")) return entryHtml;
    if (!isWebVpnGatewayPage(entryHtml)) return entryHtml;
    try {
        await uFetch(LOGOUT_URL);
    } catch {
        // Best effort: a failed logout must not mask the OAuth retry below.
    }
    const retried = await uFetch(WEB_VPN_OAUTH_LOGIN_URL);
    if (isUsableLoginEntry(retried, "i_user")) return retried;
    const direct = await uFetch(ID_BASE_URL);
    return isUsableLoginEntry(direct, "i_user") ? direct : retried;
};

/** Submit at most one recognized ID confirmation form. A returned password form is
 * usable input for idLoginResponse, not a public-key failure. Transport errors
 * retain their status/cause; an HTTP 429 must never become a missing-key error. */
export const passwordlessEntry = async (helper: InfoHelper, entryHtml: string): Promise<string | null> => {
    if (!helper.trustBrowser) {
        return null;
    }
    const $ = cheerio.load(entryHtml);
    const form = $("form")
        .filter((_i, f) => $(f).find("input[name='fingerPrint']").length > 0
            || /checkSingle|security_check/.test($(f).attr("action") ?? ""))
        .first();
    const action = form.attr("action");
    if (action === undefined) {
        return null;
    }
    let target: URL;
    try { target = new URL(action, ID_HOST_URL); } catch {
        throw new LoginPreparationError("unsafe-confirmation", "trusted-confirmation");
    }
    if (target.origin !== ID_HOST_URL || target.username || target.password
        || !["/do/off/ui/auth/login/checkSingle", "/security_check"].includes(target.pathname)) {
        throw new LoginPreparationError("unsafe-confirmation", "trusted-confirmation");
    }
    const body: { [key: string]: string } = Object.create(null);
    form.find("input[name]").each((_i, input) => {
        const name = $(input).attr("name")!;
        const type = ($(input).attr("type") ?? "hidden").toLowerCase();
        if (type === "hidden") body[name] = $(input).attr("value") ?? "";
    });
    body.fingerPrint = helper.fingerprint;
    body.fingerGenPrint = helper.fingerGenPrint ?? "";
    if (target.pathname.endsWith("/checkSingle")) {
        body.i_rememberme = "on";
    }
    return await uFetch(target.toString(), body);
};

/**
 * 【移植自上游 v3.19.0】Obtains the login response for the unified ID system,
 * preferring the passwordless path when the live session is trusted.
 * Entry pages may contain credentials, trusted confirmation, 2FA or an already
 * successful session; missing a key alone does not distinguish those states.
 */
export const idLoginResponse = async (
    helper: InfoHelper,
    entryHtml: string,
    idLoginUrl: string,
    scheme: "i_user" | "username",
): Promise<string> => {
    let html = entryHtml;
    // At most one confirmation POST followed by at most one credential POST.
    // Never recursively replay credentials when the school returns another form.
    for (let confirmationCount = 0; confirmationCount <= 1; confirmationCount++) {
        const stage: LoginPreparationStage = confirmationCount ? "trusted-confirmation" : "credential-entry";
        const publicKey = loginPublicKey(html, stage);
        if (publicKey !== null) {
            const response = await uFetch(idLoginUrl, await __idCredentialFormForTest(helper, publicKey, helper.password, scheme));
            if (isFinishedIdEntry(response, scheme)) return response;
            const $ = cheerio.load(response);
            const returnedKey = $("#sm2publicKey");
            const hasKey = !!(returnedKey.text().trim() || returnedKey.attr("value")?.trim());
            const failure = preparationFailure(response, stage);
            if (!hasKey && (failure.reason === "trust-limit" || failure.reason === "access-restricted")) throw failure;
            $("script, style, template, noscript, [hidden], [aria-hidden='true']").remove();
            const note = $("#msg_note").text().trim();
            if (note) throw new LoginError(note);
            throw hasKey ? new LoginPreparationError("unexpected-page", stage) : failure;
        }
        if (isFinishedIdEntry(html, scheme)) return html;
        const failure = preparationFailure(html, stage);
        if (failure.reason === "trust-limit" || failure.reason === "access-restricted") throw failure;
        if (confirmationCount === 1) {
            if (cheerio.load(html)("form[action*='checkSingle'], form[action*='security_check']").length) {
                throw new LoginPreparationError("confirmation-loop", stage);
            }
            throw failure;
        }
        const confirmed = await passwordlessEntry(helper, html);
        if (confirmed === null) throw failure;
        html = confirmed;
    }
    throw new LoginPreparationError("confirmation-loop", "trusted-confirmation");
};

let outstandingLoginPromise: Promise<void> | undefined = undefined;
let loginAttemptSequence = 0;
let outstandingLoginIdentity: {attemptId: number; userId: string} | null = null;

const twoFactorAuth = async (helper: InfoHelper): Promise<string> => {
    const { result: r1, msg: m1, object: o1 } = JSON.parse(await uFetch(DOUBLE_AUTH_URL, {
        action: "FIND_APPROACHES",
    }));
    if (r1 != "success") {
        throw new LoginError(m1);
    }
    if (!helper.twoFactorMethodHook) {
        throw new LoginError("Required to select 2FA method");
    }
    const method = await helper.twoFactorMethodHook(o1.hasWeChatBool, o1.phone, o1.hasTotp);
    if (method === undefined) {
        throw new LoginError("2FA required");
    }
    const { result: r2, msg: m2 } = JSON.parse(await uFetch(DOUBLE_AUTH_URL, {
        action: "SEND_CODE",
        type: method,
    }));
    if (r2 != "success") {
        throw new LoginError(m2);
    }
    if (!helper.twoFactorAuthHook) {
        throw new LoginError("2FA required");
    }
    const code = await helper.twoFactorAuthHook();
    if (code === undefined) {
        throw new LoginError("2FA required");
    }
    const { result: r3, msg: m3, object: o3 } = JSON.parse(await uFetch(DOUBLE_AUTH_URL, {
        action: method === "totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE",
        vericode: code,
    }));
    if (r3 != "success") {
        throw new LoginError(m3);
    }
    if (helper.trustFingerprintHook) {
        const trustFingerprint = await helper.trustFingerprintHook();
        if (trustFingerprint) {
            const parsed = JSON.parse(await uFetch(SAVE_FINGER_URL, {
                fingerprint: helper.fingerprint,
                deviceName: await helper.trustFingerprintNameHook(),
                radioVal: "是",
            }));
            const { result: r4, msg: m4 } = parsed;
            if (r4 != "success") {
                if (m4.includes("上限") || m4.includes("limit")) {
                    helper.twoFactorAuthLimitHook && await helper.twoFactorAuthLimitHook();
                }
                else {
                    throw new LoginError(m4);
                }
            }
            else {
                // 响应 object 即 finger3（bundle: saveFinger3Local(t.object)）——
                // 此前被解构丢弃，helper.fingerGenPrint 永远空 → checkSingle 确认
                // 传空指纹 → id 死结（2026-09-18 三次"已增加"实录）
                helper.fingerGenPrint = String(parsed.object ?? "") || helper.fingerGenPrint;
            }
        }
    }
    return await uFetch(ID_HOST_URL + o3.redirectUrl);
};

export const login = async (
    helper: InfoHelper,
    userId: string,
    password: string,
): Promise<void> => {
    if (userId === "" || password === "") {
        const e = new LoginError("Please login.");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    if (!userId.match(/^\d+$/)) {
        const e = new LoginError("请输入学号。");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    if (outstandingLoginPromise !== undefined) {
        if (outstandingLoginIdentity?.userId !== userId) {
            throw Object.assign(new LoginError("Another account is already signing in."), {code: "AUTH_IN_PROGRESS"});
        }
        await outstandingLoginPromise;
        return;
    }
    helper.userId = userId;
    helper.password = password;
    if (!helper.mocked()) {
        if (outstandingLoginPromise === undefined) {
            let timer: ReturnType<typeof setTimeout>;
            // Queue work after assigning outstandingLoginPromise. The admission
            // hook can await storage/cookies without allowing another caller in.
            const attempt = Promise.resolve().then(async () => {
                await helper.beforeLoginAttemptHook?.();
                clearCookies();
                await helper.clearCookieHandler();
                let entryHtml = await uFetch(WEB_VPN_OAUTH_LOGIN_URL);
                if (getRedirectLocation) {
                    // Patch for OpenHarmony
                    const oauthUrl = await getRedirectLocation(WEB_VPN_OAUTH_LOGIN_URL);
                    if (!oauthUrl) {
                        throw new LoginError("Failed to get oauth url.");
                    }
                    await uFetch(oauthUrl);
                    const idUrl = await getRedirectLocation(oauthUrl);
                    if (!idUrl) {
                        throw new LoginError("Failed to get id url.");
                    }
                    entryHtml = await uFetch(idUrl);
                }
                entryHtml = await recoverLoginEntry(entryHtml);
                let response = await idLoginResponse(helper, entryHtml, ID_LOGIN_URL, "i_user");
                if (isTwoFactorPage(response)) {
                    response = await twoFactorAuth(helper);
                }
                if (!response.includes("登录成功。正在重定向到")) {
                    const $ = cheerio.load(response);
                    const message = $("#msg_note").text().trim();
                    throw new LoginError(message);
                }
                const callbackUrl = cheerio.load(response)("a").attr()!.href;
                const redirectUrl = await (getRedirectLocation ?? getRedirectUrl)(callbackUrl);
                if (redirectUrl === LOGIN_URL || redirectUrl == null) {
                    throw new LoginError("登录失败，请稍后重试。");
                }
                if (getRedirectLocation) {
                    await uFetch(redirectUrl);
                }
                await roam(helper, "id", "10000ea055dd8d81d09d5a1ba55d39ad");
            });
            const timeout = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new LoginError("Login timeout.")), 3 * 60 * 1000);
            });
            const pending = Promise.race([attempt, timeout]).then(() => {
                clearTimeout(timer);
                if (outstandingLoginPromise === pending) {
                    outstandingLoginPromise = undefined;
                    outstandingLoginIdentity = null;
                    helper.afterLoginSuccessHook?.();
                }
            }, (e: any) => {
                clearTimeout(timer);
                if (outstandingLoginPromise === pending) {
                    outstandingLoginPromise = undefined;
                    outstandingLoginIdentity = null;
                }
                helper.loginErrorHook && helper.loginErrorHook(e);
                throw e;
            });
            outstandingLoginPromise = pending;
            outstandingLoginIdentity = {attemptId: ++loginAttemptSequence, userId};
        }
        await outstandingLoginPromise;
    }
};

/** Detach an abandoned login/2FA attempt. This does not cancel transport work;
 * settling the detached attempt must never clear a newer attempt's pointer. */
export const clearOutstandingLogin = (): void => {
    outstandingLoginPromise = undefined;
    outstandingLoginIdentity = null;
};

/** Lets the UI adopt an already waiting background authentication flow. */
export const hasOutstandingLogin = (): boolean => outstandingLoginPromise !== undefined;

/** Snapshot only: UI bridges can bind their 2FA hooks to the exact active attempt.
 * Credentials never leave the helper; callers cannot mutate the internal owner. */
export const getOutstandingLoginIdentity = (): {attemptId: number; userId: string} | null =>
    outstandingLoginIdentity ? {...outstandingLoginIdentity} : null;

export const logout = async (helper: InfoHelper): Promise<void> => {
    if (!helper.mocked()) {
        helper.userId = "";
        helper.password = "";
        await uFetch(LOGOUT_URL);
    } else {
        helper.userId = "";
        helper.password = "";
    }
};

export const roam = async (helper: InfoHelper, policy: RoamingPolicy, payload: string): Promise<string> => {
    switch (policy) {
    case "default": {
        const csrf = await getCsrfToken();
        const {object} = await uFetch(`${ROAMING_URL}?yyfwid=${payload}&_csrf=${csrf}&machine=p`).then(JSON.parse);
        const url = parseUrl(object.roamingurl.replace(/&amp;/g, "&"));
        if (url.includes(HOST_MAP["dzpj"])) {
            const roamHtml = await uFetch(url);
            const ticket = /\("ticket"\).value = '(.+?)';/.exec(roamHtml);
            if (ticket === null || ticket[1] === undefined) {
                throw new LibError("Failed to get ticket when roaming to fa-online");
            }
            return await uFetch(INVOICE_LOGIN_URL, {ticket: ticket[1]});
        }
        if (url.includes(HOST_MAP["madmodel.cs"])) {
            const ticket = /ticket=(.+)/.exec(url);
            if (ticket === null || ticket[1] === undefined) {
                throw new LibError("Failed to get ticket of madmodel.cs");
            }
            await uFetch(url);
            return await uFetch(`${MADMODEL_AUTH_LOGIN_URL}/check?ticket=${ticket[1]}`);
        }
        return await uFetch(url);
    }
    case "card":
    case "cab":
    case "cr":
    case "id_website":
    case "id": {
        const idBaseUrl = policy === "card" ? ID_BASE_URL : policy === "id_website" ? ID_WEBSITE_BASE_URL : ID_BASE_URL;
        const idLoginUrl = policy === "card" ? ID_LOGIN_URL : policy === "id_website" ? ID_WEBSITE_LOGIN_URL : ID_LOGIN_URL;
        const target = policy === "id_website" ? "账号设置" : "登录成功。正在重定向到";
        // A credential rejection is final for this attempt. Repeating the same
        // password automatically increases lockout/rate-limit risk.
        const entryHtml = await uFetch(policy === "cr" ? CR_LOGIN_HOME_URL : (idBaseUrl + payload));
        let response = await idLoginResponse(
            helper,
            entryHtml,
            idLoginUrl,
            policy === "id_website" ? "username" : "i_user",
        );
        if (isTwoFactorPage(response)) {
            response = await twoFactorAuth(helper);
        }
        if (!response.includes(target)) {
            throw new IdAuthError();
        }
        if (policy === "id_website") {
            return response;
        }
        let redirectUrl = cheerio.load(response)("a").attr()!.href;
        if (policy !== "card") {
            redirectUrl = getWebVPNUrl(redirectUrl);
            if (getRedirectLocation) {
                // Patch for OpenHarmony
                const idUrl = await getRedirectLocation(redirectUrl);
                if (!idUrl) {
                    throw new LoginError("Failed to get id url.");
                }
                redirectUrl = idUrl;
            }
        }
        return await uFetch(redirectUrl);
    }
    case "gitlab": {
        // 统一认证入口：GitLab 的「清华账号登录」按钮 POST 到 /users/auth/thuid，
        // 由它跳到 oauth.tsinghua.edu.cn/thu-oauth 再落到 id 登录页。会话仍在时该表单不存在。
        const data = await uFetch(GITLAB_LOGIN_URL);
        if (!data.includes("/users/auth/thuid")) return data;
        // CSRF 令牌在 meta[name=csrf-token]：登录页那个 input 不带 value 属性，真正的值由
        // 页内脚本从 meta 拷进去。按 input 取会得到 undefined，thuid POST 被服务端打回
        // 登录页（无任何报错），漫游链路因此永远停在未登录态。
        const authenticity_token = cheerio.load(data)("meta[name=csrf-token]").attr("content") ?? "";
        if (authenticity_token === "") {
            throw new LoginError("Failed to get gitlab csrf token.");
        }
        // 带落点回执地发起授权跳转：两种落点都正常，得分开认。
        // ① 统一认证会话仍在 → OAuth 一步过票，整条回调链走完直接回到 GitLab（无 id 表单）；
        // ② 需要重新认证 → 落到 id 登录页（#sm2publicKey），继续走下面填表那一段。
        const auth = await platformFetchWith(GITLAB_AUTH_URL, {
            method: "POST",
            body: stringify({authenticity_token}),
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
        });
        const sm2PublicKey = cheerio.load(auth.text)("#sm2publicKey").text();
        if (sm2PublicKey === "") {
            // 中间形态（id 会话仍在但不肯直接放行）：单点登录确认页 checkSingle——
            // 页面只有一个 action 指向 /do/off/ui/auth/login/checkSingle 的表单，回传隐藏字段
            // 即续用既有会话（裸传隐藏字段会被当作全新登录，进而索要二次认证；故必须带
            // i_rememberme 与指纹，与 InfoClient / venue 的处理一致）。
            const $auth = cheerio.load(auth.text);
            const action = $auth("form[action*='checkSingle']").attr("action") ?? "";
            if (action !== "") {
                // 先收页面隐藏字段（续用上下文的凭据），再用本项目自己的三个字段覆盖：
                // 反过来的话页面里空的 fingerPrint / fingerGenPrint 会盖掉真值，
                // 服务端按「全新设备」处理，直接要二次认证。
                const fields: {[key: string]: string} = {};
                $auth("input[type=hidden]").each((_, el) => {
                    const name = $auth(el).attr("name");
                    if (name) fields[name] = $auth(el).attr("value") ?? "";
                });
                fields.i_rememberme = "on";
                fields.fingerPrint = helper.fingerprint;
                fields.fingerGenPrint = helper.fingerGenPrint ?? "";
                const confirmed = await platformFetchWith(new URL(action, ID_HOST_URL).toString(), {
                    method: "POST",
                    body: stringify(fields),
                    headers: {"Content-Type": "application/x-www-form-urlencoded"},
                });
                if (confirmed.text.includes("二次认证")) {
                    // 这一跳要验证码时无法在页面内完成（漫游不弹二次认证界面），当场说清怎么解，
                    // 不许挂着不动
                    throw new LoginError(
                        "统一认证要求二次认证：请退出登录后重新登录，二次认证时勾选「信任此设备」，再回到本页刷新。",
                    );
                }
                // 回调被打回 GitLab 登录页 = 统一认证侧那枚授权码已被用过（实测：同一 sig 下
                // 反复返回同一枚已消费的 code，兑付 302 只回登录页）。此时光重试没用，
                // 必须重置 id/oauth 域的会话，让下次漫游走完整登录换一枚新码。
                if (confirmed.text.includes("/users/auth/thuid")) {
                    throw new LoginError(
                        "统一认证返回的授权已被使用，GitLab 拒绝了这次回调：请点页面上的「重置统一认证并重试」。",
                    );
                }
                const anchor = /登录成功/.test(confirmed.text) ? cheerio.load(confirmed.text)("a").attr("href") : undefined;
                return anchor ? await uFetch(new URL(anchor, ID_HOST_URL).toString()) : confirmed.text;
            }
            if (!auth.text.includes("/users/auth/thuid")) {
                return auth.text;
            }
            throw new LoginError(`GitLab 授权未完成（落到 ${auth.finalUrl}，HTTP ${auth.status}）`);
        }
        if (!helper.userId || !helper.password) {
            throw new IdAuthError("The university session requires sign-in.");
        }
        const response = await uFetch(ID_LOGIN_URL, {
            i_user: helper.userId,
            i_pass: SM2_MAGIC_NUMBER + sm2.doEncrypt(helper.password, sm2PublicKey),
            fingerPrint: helper.fingerprint,
            fingerGenPrint: helper.fingerGenPrint ?? "",
            i_captcha: "",
        });
        if (response.includes("二次认证")) {
            // 同 checkSingle：页面内漫游没有二次认证界面，等下去只会一直挂着
            throw new LoginError(
                "统一认证要求二次认证：请退出登录后重新登录，二次认证时勾选「信任此设备」，再回到本页刷新。",
            );
        }
        if (!response.includes("登录成功。正在重定向到")) {
            throw new IdAuthError();
        }
        const redirectUrl = cheerio.load(response)("a").attr()!.href;
        return await uFetch(redirectUrl);
    }
    }
};

export const verifyAndReLogin = async (helper: InfoHelper, options: {allowLogin?: boolean} = {}): Promise<boolean> => {
    if (outstandingLoginPromise) {
        await outstandingLoginPromise;
        return true;
    }
    try {
        const body = await uFetch(`${USER_DATA_URL}?_csrf=${await getCsrfToken()}`);
        if (isConfirmedLoginPage(body)) {
            throw Object.assign(new IdAuthError("The university session requires sign-in."), {code: "AUTH_SESSION_EXPIRED"});
        }
        const result = JSON.parse(body);
        if (result?.status === 401 || result?.code === 401
            || /^(?:未登录|请先登录|登录已失效|登录状态已失效|login required|not authenticated)[。.!]?$/i.test(String(result?.msg ?? result?.message ?? "").trim())) {
            throw Object.assign(new IdAuthError("The university session requires sign-in."), {code: "AUTH_SESSION_EXPIRED"});
        }
        if (result?.object?.ryh == null || String(result.object.ryh).trim() === "") {
            throw new Error("The university session probe returned an unexpected response.");
        }
        if (String(result.object.ryh) === helper.userId) {
            return false;
        }
        throw Object.assign(new IdAuthError("Saved session ownership could not be verified. Please sign in again."), {code: "AUTH_SESSION_CONFLICT"});
    } catch (e) {
        // Only a confirmed login page or HTTP 401 can start a new login chain.
        // Transport, gateway, malformed JSON and unknown response shapes retain
        // their original failure and never trigger a credential POST.
        const detail = e && typeof e === "object" ? e as {status?: number; code?: string} : {};
        if (detail.status !== 401 && detail.code !== "AUTH_SESSION_EXPIRED") throw e;
    }
    if (options.allowLogin === false) {
        throw Object.assign(new IdAuthError("The university session requires sign-in."), {code: "AUTH_SESSION_EXPIRED"});
    }
    const {userId, password} = helper;
    await login(helper, userId, password);
    return true;
};

/** Credential rejection, explicit admission failure and server restrictions are
 * final for this wrapper invocation. Retrying them can resend the same password. */
function stopAuthenticationRecovery(error: unknown): boolean {
    if (error instanceof LoginError) return true;
    if (!error || typeof error !== "object") return false;
    const detail = error as {status?: unknown; code?: unknown};
    return (typeof detail.status === "number" && detail.status >= 400 && detail.status !== 401)
        || (typeof detail.code === "string" && detail.code.startsWith("AUTH_") && detail.code !== "AUTH_SESSION_EXPIRED");
}

export const roamingWrapper = async <R>(
    helper: InfoHelper,
    policy: RoamingPolicy | undefined,
    payload: string,
    operation: (param?: string) => Promise<R>,
): Promise<R> => {
    if (helper.userId === "" || helper.password === "") {
        const e = new LoginError("Please login.");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    try {
        if (policy) {
            try {
                return await operation();
            } catch (e) {
                if (stopAuthenticationRecovery(e)) throw e;
                let result: string;
                try {
                    result = await roam(helper, policy, payload);
                } catch (e) {
                    if (stopAuthenticationRecovery(e)) throw e;
                    result = await roam(helper, policy, payload);
                }
                return await operation(result);
            }
        } else {
            return await operation();
        }
    } catch (e) {
        if (stopAuthenticationRecovery(e)) throw e;
        if (await verifyAndReLogin(helper)) {
            if (policy) {
                const result = await roam(helper, policy, payload);
                return await operation(result);
            } else {
                return await operation();
            }
        } else {
            throw e;
        }
    }
};

export const roamingWrapperWithMocks = async <R>(
    helper: InfoHelper,
    policy: RoamingPolicy | undefined,
    payload: string,
    operation: (param?: string) => Promise<R>,
    fallback: R,
): Promise<R> =>
    helper.mocked()
        ? Promise.resolve(fallback)
        : roamingWrapper(helper, policy, payload, operation);

/** A mutation gets one attempt. An explicit HTTP 401 at the original endpoint
 * means the server rejected it; that case may recover auth and
 * try once more. Network/timeout/5xx/parse failures leave the outcome unknown.
 * Keep the read wrapper's existing recovery policy independent of this path. */
export const roamingWriteWrapper = async <R>(
    helper: InfoHelper,
    policy: RoamingPolicy | undefined,
    payload: string,
    operation: (param?: string) => Promise<R>,
): Promise<R> => {
    if (helper.userId === "" || helper.password === "") {
        const error = new LoginError("Please login.");
        helper.loginErrorHook && helper.loginErrorHook(error);
        throw error;
    }
    const owner = helper.userId;
    const attempt = async (param?: string): Promise<R> => {
        const sameOwner = () => {
            if (helper.userId !== owner) throw Object.assign(new Error("Account changed during the write operation."), {code: "AUTH_SESSION_CHANGED"});
        };
        sameOwner();
        const result = await operation(param);
        sameOwner();
        return result;
    };
    try {
        return await attempt();
    } catch (error) {
        if (!(error instanceof ResponseStatusError) || error.status !== 401 || !error.directResponse) throw error;
        // There is deliberately no catch around this recovery or second write:
        // a failed response must never fall into another implicit replay tier.
        if (policy) return attempt(await roam(helper, policy, payload));
        if (await verifyAndReLogin(helper)) return attempt();
        throw error;
    }
};

export const roamingWriteWrapperWithMocks = async <R>(
    helper: InfoHelper,
    policy: RoamingPolicy | undefined,
    payload: string,
    operation: (param?: string) => Promise<R>,
    fallback: R,
): Promise<R> => helper.mocked() ? Promise.resolve(fallback) : roamingWriteWrapper(helper, policy, payload, operation);

export const forgetDevice = async (helper: InfoHelper): Promise<void> => {
    await roam(helper, "id_website", "");
    for (let i = 0; i < 10; i++) {
        const {result: r1, msg: m1, object: o1} = JSON.parse(await uFetch(CHECK_CURRENT_DEVICE_URL.replace("{fingerprint}", helper.fingerprint), {}));
        if (r1 != "success") {
            throw new LibError(m1);
        }
        if (o1 === false) {
            break;
        }
        const {result: r2, msg: m2, object: o2} = JSON.parse(await uFetch(GET_DEVICE_LIST_URL, {}));
        if (r2 != "success") {
            throw new LibError(m2);
        }
        const ourDeviceList = o2.filter(({name}: any) => name.startsWith("THU Info APP"));
        if (ourDeviceList.length > 0) {
            const {result: r3, msg: m3} = JSON.parse(await uFetch(DELETE_DEVICE_URL, {uuid: ourDeviceList[ourDeviceList.length - 1].id}));
            if (r3 != "success") {
                throw new LibError(m3);
            }
        } else {
            throw new LibError("No matching device.");
        }
    }
};
