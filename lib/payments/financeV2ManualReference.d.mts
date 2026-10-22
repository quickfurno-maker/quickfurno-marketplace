declare module "./financeV2ManualReference.mjs" {
 export function normalizeManualBankReference(
 method: unknown, reference: unknown
 ): {method:string;reference:string|null;needsBankStatementVerification:boolean};
}
export {};
