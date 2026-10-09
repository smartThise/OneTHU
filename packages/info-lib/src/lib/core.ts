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
import {clearCookies, getRedirectUrl, platformFetchWith, stringify, uFetch} from "../utils/network";
import {IdAuthError, LibError, LoginError, UrlError} from "../utils/error";
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
        throw new Error("Failed to get csrf token.");
    }
    return q[1];
};

let outstandingLoginPromise: Promise<void> | undefined = undefined;

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
    helper.userId = userId;
    helper.password = password;
    if (helper.userId === "" || helper.password === "") {
        const e = new LoginError("Please login.");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    if (!helper.userId.match(/^\d+$/)) {
        const e = new LoginError("请输入学号。");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    if (!helper.mocked()) {
        clearCookies();
        await helper.clearCookieHandler();
        if (outstandingLoginPromise === undefined) {
            outstandingLoginPromise = new Promise<void>((resolve, reject) => {
                setTimeout(() => {
                    reject(new LoginError("Login timeout."));
                }, 3 * 60 * 1000);
                (async () => {
                    await uFetch(WEB_VPN_OAUTH_LOGIN_URL);
                    let sm2PublicKey = "";
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
                        sm2PublicKey = cheerio.load(await uFetch(idUrl))("#sm2publicKey").text();
                    } else {
                        // OneTHU 适配（2026-09-17 定案）：库外层（infoLib.libLogin）
                        // 已在登录前清空原生 cookie 仓——干净客户端总是走完整
                        // OAuth 舞（表单带 sig → check → 302 webvpn/login?code=
                        // → 铸真票）。带陈旧匿名票才会被 IP 续会拦成门户页
                        // （无 key），此处保持「无 key 即报错」，由外层自愈重试。
                        const landingPage = await uFetch(WEB_VPN_OAUTH_LOGIN_URL);
                        sm2PublicKey = cheerio.load(landingPage)("#sm2publicKey").text();
                    }
                    if (sm2PublicKey === "") {
                        throw new LoginError("Failed to get public key.");
                    }
                    let response = await uFetch(ID_LOGIN_URL, {
                        i_user: helper.userId,
                        i_pass: SM2_MAGIC_NUMBER + sm2.doEncrypt(helper.password, sm2PublicKey),
                        fingerPrint: helper.fingerprint,
                        fingerGenPrint: "",
                        i_captcha: "",
                    });
                    if (response.includes("二次认证")) {
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
                    outstandingLoginPromise = undefined;
                })().then(resolve, (e: any) => {
                    helper.loginErrorHook && helper.loginErrorHook(e);
                    outstandingLoginPromise = undefined;
                    reject(e);
                });
            });
        }
        await outstandingLoginPromise;
    }
};

/** OneTHU 适配（2026-09-17）：2FA 挂起的登录链（等验证码的 futures）永不清
 *  outstandingLoginPromise——后续 login() 全都 await 这具僵尸，3 分钟后集体
 *  "Login timeout"（真机实录：开机 need-2fa 后手点登录全部无响应）。
 *  外层每次发起全新 libLogin 前调用本函数弃掉旧链（旧 futures 无人等，可 GC）。 */
export const clearOutstandingLogin = (): void => {
    outstandingLoginPromise = undefined;
};

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
        let response = "";
        const target = policy === "id_website" ? "账号设置" : "登录成功。正在重定向到";
        for (let i = 0; i < 2; i++) {
            const sm2PublicKey = cheerio.load(await uFetch(policy === "cr" ? CR_LOGIN_HOME_URL : (idBaseUrl + payload)))("#sm2publicKey").text();
            if (sm2PublicKey === "") {
                throw new LoginError("Failed to get public key.");
            }
            if (policy === "id_website") {
                response = await uFetch(idLoginUrl, {
                    username: helper.userId,
                    password:  SM2_MAGIC_NUMBER + sm2.doEncrypt(helper.password, sm2PublicKey),
                    fingerPrint: helper.fingerprint,
                    fingerGenPrint: helper.fingerGenPrint ?? "",
                    i_captcha: "",
                });
            } else {
                response = await uFetch(idLoginUrl, {
                    i_user: helper.userId,
                    i_pass:  SM2_MAGIC_NUMBER + sm2.doEncrypt(helper.password, sm2PublicKey),
                    fingerPrint: helper.fingerprint,
                    fingerGenPrint: helper.fingerGenPrint ?? "",
                    i_captcha: "",
                });
            }
            if (response.includes("二次认证")) {
                response = await twoFactorAuth(helper);
            }
            if (response.includes(target)) {
                break;
            }
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
        let response = await uFetch(ID_LOGIN_URL, {
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

export const verifyAndReLogin = async (helper: InfoHelper): Promise<boolean> => {
    if (outstandingLoginPromise) {
        await outstandingLoginPromise;
        return true;
    }
    try {
        const {object} = await uFetch(`${USER_DATA_URL}?_csrf=${await getCsrfToken()}`).then(JSON.parse);
        if (object.ryh === helper.userId) {
            return false;
        }
    } catch {
        //
    }
    const {userId, password} = helper;
    await login(helper, userId, password);
    return true;
};

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
            } catch {
                let result: string;
                try {
                    result = await roam(helper, policy, payload);
                } catch {
                    result = await roam(helper, policy, payload);
                }
                return await operation(result);
            }
        } else {
            return await operation();
        }
    } catch (e) {
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
