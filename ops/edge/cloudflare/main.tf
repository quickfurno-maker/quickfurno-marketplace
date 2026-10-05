locals {
  public_host_expression = join(" or ", [for host in sort(tolist(var.public_hosts)) : "http.host eq \"${host}\""])

  # Cloudflare Free allows one rate-limiting rule and only path/verified-bot
  # fields in the rule expression. Keep this deliberately narrow to the
  # public vendor-auth surface; origin Redis limits remain authoritative.
  free_rate_limit_rules = [
    {
      ref         = "free_vendor_auth_per_ip"
      description = "Free-plan vendor auth/reset/OTP abuse ceiling"
      expression  = "starts_with(http.request.uri.path, \"/api/vendor/auth/\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 10
        requests_per_period = 15
        mitigation_timeout  = 10
      }
    }
  ]

  paid_rate_limit_rules = [
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

  rate_limit_rules = lower(var.cloudflare_plan) == "free" ? local.free_rate_limit_rules : local.paid_rate_limit_rules
}

resource "cloudflare_zone_setting" "ssl_strict" {
  count      = var.enable_strict_ssl ? 1 : 0
  zone_id    = var.cloudflare_zone_id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "global_aop" {
  count      = var.enable_global_aop ? 1 : 0
  zone_id    = var.cloudflare_zone_id
  setting_id = "tls_client_auth"
  value      = "on"
}

# Free zones receive the Cloudflare Free Managed Ruleset automatically. This
# resource intentionally manages only the paid Cloudflare Managed Ruleset.
# A zone has one entry-point ruleset per phase, so existing rules must be
# imported/reconciled before this resource is enabled.
resource "cloudflare_ruleset" "managed_waf" {
  count       = var.enable_managed_waf && lower(var.cloudflare_plan) != "free" ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "QuickFurno managed WAF"
  description = "Phase 10 paid managed WAF entry point"
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
  description = "Plan-compatible edge abuse ceilings; origin business controls remain authoritative"
  kind        = "zone"
  phase       = "http_ratelimit"
  rules       = local.rate_limit_rules
}

# Explicit cache rules are independently gated because the API requires
# account-level Cache Rules prerequisites. Cloudflare's normal CDN behavior
# and immutable Next.js asset headers remain active when this is disabled.
resource "cloudflare_ruleset" "cache_rules" {
  count       = var.enable_cache_rules ? 1 : 0
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
