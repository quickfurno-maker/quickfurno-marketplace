export function createWhatsAppToolPlaceholder() {
  return {
    name: "whatsappTool",
    enabled: false,
    canSend: false,
    description: "Placeholder only. This tool never sends WhatsApp messages in Phase 1.",
    // TODO: Require admin approval and audited templates before enabling sends.
  };
}

