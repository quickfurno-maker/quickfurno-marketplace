quickfurno_hosts = {
  qf-a = {
    private_address = "10.40.16.11"
    failure_domain  = "host-a"
  }
  qf-b = {
    private_address = "10.40.16.12"
    failure_domain  = "host-b"
  }
}

shared_redis_url           = "rediss://valkey.internal.example:6379"
agni_otlp_gateway_endpoint = "agni.internal.example:4317"
