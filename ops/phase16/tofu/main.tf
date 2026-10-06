terraform {
  required_version = ">= 1.6.0"
}

variable "quickfurno_hosts" {
  description = "Provider-owned host inventory consumed by the Phase 16 bootstrap module."
  type = map(object({
    private_address = string
    failure_domain  = string
  }))

  validation {
    condition     = length(var.quickfurno_hosts) >= 2
    error_message = "Phase 16 HA requires at least two QuickFurno hosts."
  }
}

variable "shared_redis_url" {
  description = "Shared Redis/Valkey endpoint. Loopback is forbidden for multi-host mode."
  type        = string

  validation {
    condition     = !can(regex("(^|://)(127\\.0\\.0\\.1|localhost|::1)(:|/|$)", var.shared_redis_url))
    error_message = "Multi-host QuickFurno cannot use host-local Redis/Valkey."
  }
}

variable "agni_otlp_gateway_endpoint" {
  description = "Jarvis/AGNI-side central OTLP gateway endpoint."
  type        = string
}

locals {
  bootstrap = {
    for host_id, host in var.quickfurno_hosts :
    host_id => templatefile("${path.module}/cloud-init.tftpl", {
      host_id                    = host_id
      agni_otlp_gateway_endpoint = var.agni_otlp_gateway_endpoint
    })
  }
}

output "quickfurno_host_bootstrap" {
  value       = local.bootstrap
  description = "Cloud-init payloads for provider-specific VPS resources."
  sensitive   = true
}
