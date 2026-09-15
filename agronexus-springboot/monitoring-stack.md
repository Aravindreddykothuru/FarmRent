# AgroNexus Production Monitoring Stack & Alerting Policies

This document outlines the observability, metrics collection, exception tracking, and alerting configuration for the production AgroNexus Spring Boot application.

## Observability Architecture

```
                                      ┌───────────────┐
                                 ┌───►│  UptimeRobot  │ (External Ping)
                                 │    └───────────────┘
                                 │
┌───────────────────────┐        │    ┌───────────────┐
│  AgroNexus API Pods   ├────────┼───►│    Sentry     │ (Exception Log)
│  (Micrometer Enabled) │        │    └───────────────┘
└──────────┬────────────┘        │
           │                     │    ┌───────────────┐
           │ (/actuator/promo)   ├───►│  CloudWatch   │ (AWS Infra Logs)
           ▼                     │    └───────────────┘
     ┌───────────┐               │
     │Prometheus │               │    ┌───────────────┐
     └─────┬─────┘               └───►│ Supabase Dash │ (SQL Analytics)
           │                          └───────────────┘
           ▼
     ┌───────────┐                    ┌───────────────┐
     │  Grafana  ├───────────────────►│  PagerDuty /  │ (On-Call Alert)
     └───────────┘                    │   Opsgenie    │
                                      └───────────────┘
```

---

## 1. Monitoring Components

| Tool | Purpose | Key Alerts / Thresholds | Setup & Integration |
| :--- | :--- | :--- | :--- |
| **Prometheus + Grafana** | Application metrics, custom dashboards, latency percentiles. | <ul><li>API p99 latency > 1.0s</li><li>Http error rate (5xx) > 1.0%</li><li>Pod restart rate > 2 in 10m</li></ul> | Integrates via Spring Boot Actuator using Micrometer (`io.micrometer:micrometer-registry-prometheus`). Prometheus scrapes `/actuator/prometheus` endpoint every 15s. |
| **Sentry** | Real-time exception tracking and stack trace analysis. | <ul><li>New error type observed</li><li>Spike in error count (>50 in 1m)</li></ul> | Integrates via standard Sentry logback/log4j2 appender dependency (`io.sentry:sentry-spring-boot-starter-jakarta`). Captures unhandled exceptions globally. |
| **AWS CloudWatch** | Infrastructure metrics (ECS/EKS nodes), memory usage, and execution logs. | <ul><li>EKS Cluster CPU utilization > 80%</li><li>RDS Database connection count > 85% of limit</li></ul> | Logs forwarded via FluentBit daemonset on the EKS cluster. System alarms hook directly to SNS topics. |
| **Supabase Dashboard** | Database query performance tracking, lock detection, and connection pooling status. | <ul><li>Average query duration > 100ms</li><li>HikariCP pool wait time > 250ms</li></ul> | Built-in Supabase Postgres slow query logging (`pg_stat_statements`). Managed pool monitoring. |
| **PagerDuty / Opsgenie** | On-call incident response and paging. | <ul><li>Critical payment failure alerts</li><li>Active WebSocket disconnects > 100 in 5m</li></ul> | Integrated via webhook endpoints for Grafana Alertmanager, AWS CloudWatch, and Sentry triggers. |
| **UptimeRobot** | External, independent synthetic uptime monitoring. | <ul><li>Actuator health endpoint down for > 1 min</li></ul> | Configured to ping `https://api.agronexus.in/actuator/health` at 1-minute intervals from multiple geo-locations. |

---

## 2. Spring Boot Prometheus Metric Mapping

The following Prometheus metrics are mapped to monitor application health in real time:

- **JVM Memory**: `jvm_memory_used_bytes` / `jvm_memory_max_bytes`
- **Request Latency**: `http_server_requests_seconds_bucket` (provides p95/p99 histograms)
- **Error Rates**: `http_server_requests_seconds_count{status=~"5.*"}`
- **Active Connections**: `hikaricp_connections_active` (database pool exhaustion tracking)

## 3. Incident Severity Escalation Policy

1. **P0 (Critical - Immediate PagerDuty page)**:
   - External health check returns `DOWN` for > 60 seconds.
   - Database connection exhaustion (no free pool connections).
   - Payment initiation endpoint failure rate > 5%.
2. **P1 (High - Slack alert + PagerDuty notification if unresolved in 15 mins)**:
   - API p99 response time > 1.0s for a duration of 5 minutes.
   - Sentry registers a sudden spike in general runtime exceptions.
3. **P2 (Medium - Slack Alert / Email)**:
   - EKS Pod CPU/Memory > 75%.
   - Redis memory usage > 80% of configured max memory (512MB).
