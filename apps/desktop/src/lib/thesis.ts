import { THESIS_IDENTITY_URL, normalizeThesisCallback } from "@onethu/sdk/validation";
import { obtainCampusCallback } from "./campusServiceAuth.js";

/** Keep the thesis service's one-use ticket inside the account transport. */
export function thesisGatewayCallback(): Promise<string | null> {
  return obtainCampusCallback(THESIS_IDENTITY_URL, normalizeThesisCallback, "thesis");
}
