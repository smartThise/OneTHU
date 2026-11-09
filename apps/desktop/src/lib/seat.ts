import { SEAT_IDENTITY_URL, normalizeSeatCallback } from "@onethu/sdk/validation";
import { obtainCampusCallback } from "./campusServiceAuth.js";

/** The seat ticket remains private until the daemon exchanges and verifies it. */
export function seatGatewayCallback(): Promise<string | null> {
  return obtainCampusCallback(SEAT_IDENTITY_URL, normalizeSeatCallback, "seat");
}
