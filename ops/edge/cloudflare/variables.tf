variable "cloudflare_api_token" {
  description = "Cloudflare API token. Supply via TF_VAR_cloudflare_api_token; never commit it."
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID for quickfurno.in."
  type        = string
}

variable "cloudflare_plan" {
  description = "Cloudflare zone plan used to select plan-compatible edge controls."
  type        = string
  default     = "free"

  validation {
    condition     = contains(["free", "pro", "business", "enterprise"], lower(var.cloudflare_plan))
    error_message = "cloudflare_plan must be free, pro, business, or enterprise."
  }
}

variable "public_hosts" {
  description = "Cloudflare-proxied public QuickFurno hosts."
  type        = set(string)
  default     = ["quickfurno.in", "www.quickfurno.in", "jarvis.quickfurno.in"]
}

variable "enable_managed_waf" {
  description = "Deploy the paid Cloudflare Managed Ruleset. Ignored on Free, where Cloudflare auto-deploys the Free Managed Ruleset."
  type        = bool
  default     = false
}

variable "enable_edge_rules" {
  description = "Enable the custom firewall and plan-compatible rate-limit rules after existing phase rulesets are reconciled."
  type        = bool
  default     = false
}

variable "enable_cache_rules" {
  description = "Enable explicit cache rules after account-level Cache Rules prerequisites and existing rulesets are reconciled."
  type        = bool
  default     = false
}
