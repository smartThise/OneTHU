import { http, logLine, session } from "./clients.js";
import { assertNativeSessionEpoch, nativeSessionEpoch } from "./transport.js";

const ID_ORIGIN = "https://id.tsinghua.edu.cn";
const ID_CHECK = ID_ORIGIN + "/do/off/ui/auth/login/check";
const MAX_PAGE_LENGTH = 256 * 1024;
type CampusService = "stu" | "cab" | "discover" | "myhome" | "seat" | "thesis";
type NormalizeCallback = (callback: string) => string | null;
const SERVICE_ORIGINS = { stu: "https://stu.cs.tsinghua.edu.cn", cab: "https://cab.lib.tsinghua.edu.cn", discover: "https://idp.tsinghua.edu.cn", myhome: "https://myhome.tsinghua.edu.cn", seat: "https://seat.lib.tsinghua.edu.cn", thesis: "https://newetds.lib.tsinghua.edu.cn" };
const SERVICE_FORMS = {
  stu: "/do/off/ui/auth/login/form/084cc75356bf414dcfb0e6e259081f4f/0",
  cab: "/do/off/ui/auth/login/form/979ef8ab2cb121846385bad28db48fac/0",
  discover: "/do/off/ui/auth/login/form/f2841607a1c6b880847ee635cc5046f0/1",
  myhome: "/do/off/ui/auth/login/form/0a993de7e533cd43a594459abdcab27d/1",
  seat: "/do/off/ui/auth/login/form/ef84f6d6784f6b834e5214f432d6173f/0",
  thesis: "/do/off/ui/auth/login/form/4bf1579bc0410fc7dff3fd1db40d399e/0",
};

function diagnostic(service: CampusService, stage: string, fields: Record<string, string | number | boolean> = {}): void {
  void logLine("[GATEWAY-" + service.toUpperCase() + "] stage=" + stage + Object.entries(fields)
    .map(([key, value]) => " " + key + "=" + String(value)).join("")).catch(() => undefined);
}

function parsePage(html: string): Document | null {
  if (html.length > MAX_PAGE_LENGTH) return null;
  return new DOMParser().parseFromString(html, "text/html");
}

function pageDestinations(document: Document): string[] {
  const candidates = Array.from(document.querySelectorAll("a[href]"), anchor => anchor.getAttribute("href") ?? "");
  for (const meta of document.querySelectorAll("meta[http-equiv]")) {
    if (meta.getAttribute("http-equiv")?.toLowerCase() !== "refresh") continue;
    const destination = /^\s*0\s*;\s*url\s*=\s*(.*?)\s*$/i.exec(meta.getAttribute("content") ?? "")?.[1];
    if (destination) candidates.push(destination.replace(/^(["'])(.*)\1$/, "$2"));
  }
  return candidates;
}

function callbackFromPage(html: string, normalizeCallback: NormalizeCallback, base: string): string | null {
  const document = parsePage(html);
  if (!document) return null;
  for (const candidate of pageDestinations(document)) {
    try {
      const target = new URL(candidate, base).href;
      const callback = normalizeCallback(target);
      if (callback) return callback;
    } catch { /* An unrelated malformed link cannot grant a callback. */ }
  }
  return null;
}

function passwordPage(document: Document): boolean {
  return document.querySelector("#sm2publicKey, input[name='i_pass'], input[type='password']") !== null;
}

function requiresVerification(document: Document): boolean {
  const copy = document.cloneNode(true) as Document;
  copy.querySelectorAll("script, style, template, noscript").forEach(node => node.remove());
  return /二次认证|二次验证|双因素|双因子|two.factor.authentication/i.test(copy.documentElement.textContent ?? "");
}

function diagnosePage(service: CampusService, stage: string, html: string, normalizeCallback: NormalizeCallback, base: string): void {
  const document = parsePage(html);
  if (!document) { diagnostic(service, stage, { page: "oversized" }); return; }
  diagnostic(service, stage, {
    callback: callbackFromPage(html, normalizeCallback, base) !== null,
    loginForm: passwordPage(document), verify: requiresVerification(document),
    confirmation: document.querySelector("form[action*='checkSingle']") !== null,
  });
  const candidates = pageDestinations(document).slice(0, 4);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, base);
      const keys = [...url.searchParams.keys()];
      const knownKeys = ["ticket", "code", "returnto", "state", "error"];
      // Only fixed shape labels and known key names are logged. An arbitrary
      // URL path or query name can itself contain a secret.
      diagnostic(service, stage + "-link", {
        host: url.origin === SERVICE_ORIGINS[service] ? service : url.origin === ID_ORIGIN ? "identity" : "other",
        serviceHost: url.hostname === new URL(SERVICE_ORIGINS[service]).hostname, scheme: url.protocol === "http:" ? "http" : url.protocol === "https:" ? "https" : "other", hasPort: Boolean(url.port),
        path: url.pathname === "/api/user/tsinghua-auth-callback" || /^\/authcenter\/doAuth\/[a-f0-9]{32}$/i.test(url.pathname) ? "callback"
          : url.pathname === "/api/v2/authorize" ? "authorize"
          : url.pathname === "/csnova/oauth_authorized" ? "csnova" : "other",
        keys: knownKeys.filter(key => keys.includes(key)).join(",") || "none",
        otherKeys: keys.some(key => !knownKeys.includes(key)),
        accepted: normalizeCallback(url.href) !== null,
      });
    } catch { diagnostic(service, stage + "-link", { shape: "invalid" }); }
  }
}

/** Request only a caller-validated registered service and retain the callback
 * in the native account boundary until its exact transaction is checked. */
export async function obtainCampusCallback(
  identityUrl: string,
  normalizeCallback: NormalizeCallback,
  service: CampusService,
): Promise<string | null> {
  let identity: URL;
  try { identity = new URL(identityUrl); } catch { return null; }
  if (identity.origin !== ID_ORIGIN || identity.pathname !== SERVICE_FORMS[service]
      || identity.username || identity.password || identity.port || identity.hash
      || identity.href !== identityUrl || /[\x00-\x20\x7f\\]/.test(identityUrl)) return null;
  const epoch = await nativeSessionEpoch();
  const owner = session.username;
  const fingerprint = session.fingerprint;
  const check = async () => {
    await assertNativeSessionEpoch(epoch);
    if (!owner || session.username !== owner || session.state !== "ready" || session.fingerprint !== fingerprint) {
      throw new Error("AUTH_SESSION_CHANGED");
    }
  };
  await check();
  const { libHydrateCredentials, libLoginPending, helper } = await import("./infoLib.js");
  await check();
  const pending = libLoginPending();
  diagnostic(service, "entry", { accepted: true, pending });
  if (pending) return null;

  const readIdentityPage = async (response: Response, requested: string, stage: string) => {
    await check();
    const finalUrl = new URL(response.headers.get("x-onethu-final-url") || response.url || requested);
    diagnostic(service, stage + "-response", {
      status: response.status,
      final: finalUrl.origin === ID_ORIGIN ? "identity" : finalUrl.hostname === "webvpn.tsinghua.edu.cn" ? "webvpn"
        : finalUrl.origin === SERVICE_ORIGINS[service] ? service : "other",
      location: response.headers.has("location"),
    });
    // Native HTTP currently follows redirects. If it has reached the service,
    // that callback may already be consumed and must not be handed out again.
    if (finalUrl.origin !== ID_ORIGIN) {
      await response.body?.cancel();
      return null;
    }
    const location = response.headers.get("location");
    if (location) {
      const target = new URL(location, finalUrl).href;
      const callback = normalizeCallback(target);
      const accepted = callback !== null;
      diagnostic(service, stage + "-location", { accepted });
      if (callback) return { html: "", callback };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const html = await response.text();
    await check();
    diagnosePage(service, stage + "-page", html, normalizeCallback, finalUrl.href);
    return html.length <= MAX_PAGE_LENGTH ? { html, callback: callbackFromPage(html, normalizeCallback, finalUrl.href) } : null;
  };

  let page = await readIdentityPage(await http.request(identityUrl, { direct: true, redirect: "manual" }), identityUrl, "initial");
  if (!page || page.callback) return page?.callback ?? null;
  let document = parsePage(page.html);
  if (!document) return null;

  // Confirm an existing trusted session once. Preserve the school's hidden
  // target fields without adding a new device or requesting a verification code.
  if (!passwordPage(document)) {
    if (requiresVerification(document)) { diagnostic(service, "confirmation", { result: "verification-required" }); return null; }
    const forms = Array.from(document.querySelectorAll("form[action]")).filter(form => {
      try {
        const action = new URL(form.getAttribute("action")!, ID_ORIGIN);
        return action.href === ID_ORIGIN + "/do/off/ui/auth/login/checkSingle";
      } catch { return false; }
    });
    diagnostic(service, "confirmation", { forms: forms.length === 0 ? "none" : forms.length === 1 ? "one" : "multiple" });
    if (forms.length !== 1) return null;
    const fields = new URLSearchParams();
    for (const input of forms[0]!.querySelectorAll<HTMLInputElement>("input[type='hidden'][name]")) {
      if (!/pass|singleLogin|deviceName|finger|remember/i.test(input.name)) fields.set(input.name, input.value);
    }
    fields.set("fingerPrint", fingerprint);
    fields.set("fingerGenPrint", session.finger3 ?? "");
    fields.set("fingerGenPrint3", session.finger3 ?? "");
    await check();
    if (libLoginPending()) { diagnostic(service, "confirmation", { result: "login-pending" }); return null; }
    const action = ID_ORIGIN + "/do/off/ui/auth/login/checkSingle";
    page = await readIdentityPage(await http.request(action, {
      direct: true, redirect: "manual", method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: fields,
    }), action, "confirmation");
    if (!page || page.callback) return page?.callback ?? null;
    document = parsePage(page.html);
    if (!document) return null;
  }

  diagnostic(service, "credentials-before-hydrate", { loginForm: passwordPage(document), pending: libLoginPending() });
  if (!passwordPage(document) || libLoginPending()) return null;
  await libHydrateCredentials();
  await check();
  diagnostic(service, "credentials-after-hydrate", { ownerMatches: helper.userId === owner, credentialsAvailable: !!helper.password, pending: libLoginPending() });
  if (helper.userId !== owner || !helper.password || libLoginPending()) return null;
  const { InfoHelper, idLoginResponse } = await import("@onethu/info-lib");
  await check();
  const serviceHelper = new InfoHelper();
  serviceHelper.userId = owner;
  serviceHelper.password = helper.password;
  serviceHelper.fingerprint = fingerprint;
  serviceHelper.fingerGenPrint = session.finger3 ?? "";
  serviceHelper.trustBrowser = false;
  serviceHelper.singleSignOn = false;
  try {
    // idLoginResponse submits the recognized credential form once. With trust
    // disabled it cannot loop through confirmations or register a fingerprint.
    const html = await idLoginResponse(serviceHelper, page.html, ID_CHECK, "i_user");
    await check();
    diagnosePage(service, "credentials-result", html, normalizeCallback, ID_CHECK);
    return callbackFromPage(html, normalizeCallback, ID_CHECK);
  } finally {
    serviceHelper.password = "";
  }
}
