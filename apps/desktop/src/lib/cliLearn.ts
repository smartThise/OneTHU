/** Desktop ports for the shared SDK learning service. */
import { createLearnService } from "@onethu/sdk/learn";
import { learn, http, session, sessionUrl } from "./clients.js";
import { mcpServerEnabled } from "../state/userext.js";
import { ohAuthorized } from "../state/privacyConsent.js";
import { assertNativeSessionEpoch, nativeSessionEpoch, isTauri } from "./transport.js";
export type { CliLearnOperation } from "@onethu/sdk/learn";
const service = createLearnService({
  learn, http, session, sessionUrl,
  authorize() {
    if (!ohAuthorized()) throw new Error("OH_AUTHORIZATION_REQUIRED");
  },
  epoch: nativeSessionEpoch,
  assertEpoch: assertNativeSessionEpoch,
  parseElements(html) {
    return new DOMParser().parseFromString(html, "text/html").querySelectorAll("img[src], img[srcset], source[src], source[srcset], audio[src], video[src], video[poster], a[href]");
  },
  async download(args, control) {
    if (!isTauri) throw new Error("CLI_NATIVE_REQUIRED");
    const { invoke } = await import("@tauri-apps/api/core");
    await control?.beforeWrite?.();
    if (control?.signal?.aborted) throw new Error("LEARN_DOWNLOAD_CANCELLED");
    const random = new Uint32Array(2); crypto.getRandomValues(random);
    const requestId = (random[0]! & 0x1fffff) * 0x100000000 + random[1]!;
    const cancel = () => { void invoke("cli_download_cancel", { requestId }).catch(() => undefined); };
    control?.signal?.addEventListener("abort", cancel, { once: true });
    try { return await invoke<Record<string, unknown>>("cli_download_learn_resource", { ...args, requestId }); }
    finally { control?.signal?.removeEventListener("abort", cancel); }
  },
});
export const cliLearnOperations = service.operations;
export const runCliLearnDownloadWithDeadline = service.runDownload;
