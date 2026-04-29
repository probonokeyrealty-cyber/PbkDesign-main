# PBK Monitoring Stack

This stack gives PBK a local Prometheus + Grafana observability layer.

Steps:

1. Run `npm run monitoring:render-config`
2. Review `ops/monitoring/prometheus/generated.prometheus.yml`
3. Start the stack:

```bash
docker compose -f ops/monitoring/docker-compose.observability.yml up -d
```

Grafana provisions a default PBK runtime dashboard from `grafana/dashboards/pbk-runtime.json`.
