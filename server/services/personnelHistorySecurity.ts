import { encryptSecret, revealBusinessSecret } from "./secretVault";

type Change = { before: unknown; after: unknown };
export type PersonnelHistoryChanges = Record<string, Change>;
const privateFields = new Set([
  "phoneMasked", "phoneNumber", "identityMasked", "identityNo",
  "bankMasked", "bankAccount", "emergencyContactPhoneMasked", "emergencyContactPhone",
]);

/** Full authorized display is independent of encryption at rest. Old plain history remains readable. */
export function protectPersonnelHistory(changes: PersonnelHistoryChanges): PersonnelHistoryChanges {
  return Object.fromEntries(Object.entries(changes).map(([key, change]) => {
    if (!privateFields.has(key)) return [key, change];
    const encode = (value: unknown) => typeof value === "string" && value ? encryptSecret(value) : value;
    return [key, { before: encode(change.before), after: encode(change.after) }];
  }));
}

export function revealPersonnelHistory(changes: PersonnelHistoryChanges | null | undefined): PersonnelHistoryChanges {
  return Object.fromEntries(Object.entries(changes ?? {}).map(([key, change]) => {
    if (!privateFields.has(key) || !change || typeof change !== "object") return [key, change];
    const decode = (value: unknown) => typeof value === "string" && value.startsWith("v1.") ? revealBusinessSecret(value) : value;
    return [key, { before: decode(change.before), after: decode(change.after) }];
  }));
}
