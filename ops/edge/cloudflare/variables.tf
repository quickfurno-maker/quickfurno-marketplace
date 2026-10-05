variable "cloudflare_api_token" {
  description = "Cloudflare API token. Supply via TF_VAR_cloudflare_api_token; never commit it."
  type        = string
  sensitive   = true
}
variable "cloudflare_zone_id" {
  description = "Zone ID for quickfurno.in."
  type        = string
}
variable "public_hosts" {
  description = "Cloudflare-proxied public QuickFurno hosts."
  type        = set(string)
  default     = ["quickfurno.in", "www.quickfurno.in", "jarvis.quickfurno.in"]
}
variable "enable_managed_waf" {
  description = "Enable managed WAF only after existing phase rules have been imported/reconciled."
  type        = bool
  default     = false
}
variable "enable_edge_rules" {
  description = "Enable custom firewall/rate/cache rules only after existing rulesets have been imported/reconciled."
  type        = bool
  default     = false
}
