locals {
  public_host_expression = join(" or ", [for host in sort(tolist(var.public_hosts)) : "http.host eq \"${host}\""])
}

# A zone has one entry-point ruleset per phase. Import/reconcile existing
# dashboard-created rulesets before enabling these resources.
resource "cloudflare_ruleset" "managed_waf" {
  count       = var.enable_managed_waf ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "QuickFurno managed WAF"
  description = "Phase 10 managed WAF entry point"
  kind        = "zone"
  phase       = "http_request_firewall_managed"
  rules = [{
    ref         = "execute_cloudflare_managed_ruleset"
    description = "Execute Cloudflare managed WAF for QuickFurno public hosts"
    expression  = "(${local.public_host_expression})"
    action      = "execute"
    action_parameters = {
      id = "efb7b8c949ac4650a09736fc376e9aee"
    }
  }]
}

resource "cloudflare_ruleset" "custom_firewall" {
  count       = var.enable_edge_rules ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "QuickFurno custom edge firewall"
  description = "Portable Phase 10 perimeter rules"
  kind        = "zone"
  phase       = "http_request_firewall_custom"
  rules = [{
    ref         = "block_non_standard_ports"
    description = "Reject non-standard public HTTP(S) ports"
    expression  = "(${local.public_host_expression}) and (not cf.edge.server_port in {80 443})"
    action      = "block"
  }]
}

resource "cloudflare_ruleset" "rate_limits" {
  count       = var.enable_edge_rules ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "QuickFurno endpoint rate limits"
  description = "Edge abuse ceilings; origin business controls remain authoritative"
  kind        = "zone"
  phase       = "http_ratelimit"
  rules = [
    {
      ref         = "vendor_auth_per_ip"
      description = "Vendor auth/reset/OTP abuse ceiling"
      expression  = "(${local.public_host_expression}) and starts_with(http.request.uri.path, \"/api/vendor/auth/\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 20
        mitigation_timeout  = 300
      }
    },
    {
      ref         = "admin_api_per_ip"
      description = "Admin API abuse ceiling; application authorization still required"
      expression  = "(${local.public_host_expression}) and starts_with(http.request.uri.path, \"/api/admin/\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 120
        mitigation_timeout  = 60
      }
    },
    {
      ref         = "webhooks_per_ip"
      description = "Webhook flood ceiling; origin signatures and idempotency remain mandatory"
      expression  = "(${local.public_host_expression}) and starts_with(http.request.uri.path, \"/api/webhooks/\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 300
        mitigation_timeout  = 60
      }
    },
    {
      ref         = "internal_api_per_ip"
      description = "Internal API flood ceiling; signed origin contract remains mandatory"
      expression  = "(${local.public_host_expression}) and starts_with(http.request.uri.path, \"/api/internal/\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 300
        mitigation_timeout  = 60
      }
    },
    {
      ref         = "csp_report_per_ip"
      description = "Bound CSP telemetry ingress; collector also enforces a 16 KiB body cap"
      expression  = "(${local.public_host_expression}) and http.request.uri.path eq \"/api/security/csp-report\""
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 60
        mitigation_timeout  = 60
      }
    }
  ]
}

resource "cloudflare_ruleset" "cache_rules" {
  count       = var.enable_edge_rules ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "QuickFurno safe cache rules"
  description = "Cache immutable assets only; dynamic/business traffic bypasses cache"
  kind        = "zone"
  phase       = "http_request_cache_settings"
  rules = [
    {
      ref         = "cache_next_static"
      description = "Cache immutable Next static assets"
      expression  = "(${local.public_host_expression}) and starts_with(http.request.uri.path, \"/_next/static/\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode    = "override_origin"
          default = 31536000
        }
      }
    },
    {
      ref         = "bypass_dynamic_business_paths"
      description = "Never edge-cache APIs, admin, vendor dashboard or POST/server-action traffic"
      expression  = "(${local.public_host_expression}) and (starts_with(http.request.uri.path, \"/api/\") or starts_with(http.request.uri.path, \"/admin\") or starts_with(http.request.uri.path, \"/vendor/dashboard\") or http.request.method eq \"POST\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    }
  ]
}
