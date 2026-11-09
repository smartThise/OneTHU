import { MYHOME_IDENTITY_URL, normalizeMyhomeCallback } from "@onethu/sdk/validation";
import { obtainCampusCallback } from "./campusServiceAuth.js";

/** The gateway redeems this ticket through MyHome's private WebVPN HTTP route. */
export function myhomeGatewayCallback(): Promise<string | null> {
  return obtainCampusCallback(MYHOME_IDENTITY_URL, normalizeMyhomeCallback, "myhome");
}
