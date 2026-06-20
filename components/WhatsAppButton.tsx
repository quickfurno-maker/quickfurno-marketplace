"use client";

import { WHATSAPP_NUMBER, WHATSAPP_DEFAULT_MSG, trackEvent } from "@/lib/config";

export function WhatsAppButton({
  label = "Chat on WhatsApp",
  className = "btn-ghost",
  message = WHATSAPP_DEFAULT_MSG,
  source = "generic",
}: { label?: string; className?: string; message?: string; source?: string }) {
  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-cta="whatsapp"
      data-source={source}
      onClick={() => trackEvent("whatsapp_click", { source })}
      className={className}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2a10 10 0 0 0-8.6 15l-1.4 5 5.1-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .3-3.4-.7-2.9-1.2-4.7-4.2-4.8-4.4-.2-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.1 2.3 1.5 2.6 1.6.2 0 .4 0 .6-.2l.9-1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4.1.2.1.8-.1 1.4Z" />
      </svg>
      {label}
    </a>
  );
}
