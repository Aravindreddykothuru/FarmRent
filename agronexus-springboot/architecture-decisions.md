# AgroNexus Key Architectural Decisions & Launch Risks

This document outlines the core architectural principles, critical pre-launch security gates, and database design highlights for the AgroNexus platform.

---

## 🚨 The 3 Critical Risks (Must Fix Before Launch)

If not resolved before going live, these three vulnerabilities will compromise or disrupt the public launch:

1. **Supabase Row-Level Security (RLS) Exposure**:
   - *Risk*: Without RLS, any authenticated user can query or modify other users' payment records and order details directly via PostgREST.
   - *Fix*: Enable and test RLS policies on every single database table prior to routing production traffic.
2. **JWT Refresh Token Rotation**:
   - *Risk*: A stolen refresh token remains valid indefinitely, creating a severe account hijacking surface.
   - *Fix*: Implement automatic refresh token rotation on every validation use. If a reuse is detected, invalidate the entire token family.
3. **Idempotency Keys on Payment Retries**:
   - *Risk*: Network retries (frequent on India's mobile networks) will cause duplicate charges and double-payments on Razorpay gateway endpoints.
   - *Fix*: Require a unique client-side `Idempotency-Key` header on all payment initiation endpoints to intercept duplicate retry payloads.

---

## 🏗️ Architecture Design & Scaling Rationale

### 1. GPS Real-Time Tracking: WebSocket + Redis Pub/Sub
- *Polling Bottleneck*: Polling the database at a standard 10-second interval for 20,000 active rentals generates **2,000 requests per second (RPS)** just for location updates. This will quickly exhaust database connection pools.
- *Push Fanout*: By using a WebSocket server with a Redis Pub/Sub backend, GPS coordinates are published to a Redis channel and instantly fanned out to connected watchers (owners, renters, admins) in real-time (<500ms latency) without hitting the PostgreSQL database for read queries.

### 2. Design Pattern: Modular Monolith
- *Monolith First*: Do not begin with a distributed microservices architecture, as it introduces substantial DevOps overhead without immediate benefits.
- *Clean Module Boundaries*: Structure the Spring Boot application into distinct modules (`auth-module`, `marketplace-module`, `payment-module`, etc.). This maintains clean, logical boundaries, making it straightforward to extract individual modules into dedicated microservices later if scaling demands require it.

---

## 💾 Database Architecture Highlights

* **Table Partitioning for GPS Logs**:
  - The `gps_locations` table uses `PARTITION BY RANGE (recorded_at)` to partition data monthly. This prevents performance degradation as the table grows to billions of rows.
* **Geospatial Proximity (PostGIS)**:
  - The equipment location uses a PostGIS `GEOGRAPHY` column combined with a GiST spatial index. Proximity queries ("find equipment within 50km") are executed directly in the database, avoiding expensive spatial math in the application code.
* **Roadmap Prioritization**:
  - The 20-week roadmap places all security, infrastructure, and database hardening tasks in **Phase 1 (Weeks 1–4)**. No business features are built until the foundation is secure.
