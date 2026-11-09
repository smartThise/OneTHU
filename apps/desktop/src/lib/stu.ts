import { parseStuAuthEntry, normalizeStuCallback } from "@onethu/sdk/validation";
import { logLine } from "./clients.js";
import { obtainCampusCallback } from "./campusServiceAuth.js";

/** Obtain the school's unredeemed callback for this exact CSNova transaction. */
export async function stuGatewayCallback(entry: string): Promise<string | null> {
  const transaction = parseStuAuthEntry(entry);
  if (!transaction) {
    void logLine("[GATEWAY-STU] stage=entry accepted=false").catch(() => undefined);
    return null;
  }
  return obtainCampusCallback(transaction.identityUrl, callback => normalizeStuCallback(callback, entry), "stu");
}
