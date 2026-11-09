import { parseCabIdentity, normalizeCabCallback } from "@onethu/sdk/validation";
import { obtainCampusCallback } from "./campusServiceAuth.js";

/** The daemon creates the room-booking transaction before requesting a ticket. */
export async function cabGatewayCallback(entry: string, identityUrl: string): Promise<string | null> {
  const transaction = parseCabIdentity(entry, identityUrl);
  if (!transaction) return null;
  return obtainCampusCallback(transaction.identityUrl,
    callback => normalizeCabCallback(callback, entry, identityUrl), "cab");
}
