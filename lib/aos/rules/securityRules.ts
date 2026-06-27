export const securityRules = {
  serviceRoleClientSideAllowed: false,
  envFileAccessAllowed: false,
  aiApiCallsAllowed: false,
  whatsappSendsAllowed: false,
  n8nCallsAllowed: false,
  databaseWritesAllowed: false,
} as const;

export function isBlockedSideEffect(action: string): boolean {
  return ["ai", "whatsapp", "n8n", "db-write", "email"].includes(action);
}

