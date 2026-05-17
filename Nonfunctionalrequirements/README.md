# 🌾 Farm Machine Rental API — v2 (Performance & Security Edition)

A production-grade API engineered for **sub-2-second response times**, **military-grade security**, **horizontal scalability**, and **five-nine availability**.

---

## ⚡ Performance Architecture

```
Client Request
      │
      ▼
  [Nginx]  ← Layer 0: HTTP/2, gzip, 30s nginx cache, DDoS protection
      │
      ▼
  [Node.js Cluster]  ← Layer 1: All CPU cores, round-robin OS load balancing
      │
      ▼
  [Rate Limiter]  ← Layer 2: Per-route rate limits (Redis-backed in production)
      │
      ▼
  [Security Middleware]  ← Layer 3: Helmet, CORS, NoSQL injection, HPP, XSS
      │
      ▼
  [Redis Cache]  ← Layer 4: In-memory cache (50ms reads vs 200ms+ DB)
      │ (cache miss)
      ▼
  [Circuit Breaker]  ← Layer 5: Fail-fast if DB is degraded
      │
      ▼
  [Repository Layer]  ← Layer 6: Optimized queries with compound indexes
      │
      ▼
  [MongoDB]  ← Layer 7: Connection pool (20 conns/process), 2dsphere geo index
```

### Response Time Targets

| Endpoint           | Cache HIT | Cache MISS | Target  |
|--------------------|-----------|------------|---------|
| Search (filtered)  | < 50ms    | < 400ms    | < 2000ms |
| Geo / Nearby       | < 50ms    | < 200ms    | < 2000ms |
| Autocomplete       | < 10ms    | < 100ms    | < 2000ms |
| Booking CRUD       | N/A       | < 300ms    | < 2000ms |
| Health Check       | N/A       | < 10ms     | < 2000ms |

---

## 🏗️ Project Structure

```
src/
├── cache/
│   ├── cacheManager.js       # Redis client, tag invalidation, stats
│   └── cacheMiddleware.js    # HTTP response cache + auto-invalidation
├── search/
│   ├── searchService.js      # Sub-2s aggregation pipeline search
│   └── indexManager.js       # Compound + 2dsphere + text indexes
├── security/
│   ├── encryption.js         # AES-256-GCM field-level encryption
│   ├── sanitization.js       # XSS, injection prevention, PII masking, GDPR
│   └── securityMiddleware.js # Helmet, CORS, rate limiters, HPP, suspicious request detection
├── health/
│   ├── healthCheck.js        # Liveness + readiness probes + metrics
│   └── circuitBreaker.js     # Opossum circuit breaker for DB/Redis
├── repositories/
│   ├── baseRepository.js     # Repository pattern: find, create, update, delete
│   └── repositories.js       # MachineRepo, BookingRepo, UserRepo
├── cluster.js                # Multi-core cluster with zero-downtime rolling restarts
├── server.js                 # Express app with full middleware stack
└── ...controllers/routes
tests/
└── core.test.js              # Unit tests: encryption, sanitization, cache, circuit breaker
scripts/
├── benchmark.js              # Load test — validates < 2s requirement
└── nginx.conf                # Production Nginx config
```

---

## 🔐 Security Implementation

### 1. Field-Level Encryption (AES-256-GCM)
Sensitive database fields are encrypted at rest:
```js
// Encrypt before storing
enc.encrypt('+91-9876543210')
// → "enc:v1:<iv_base64>:<auth_tag_base64>:<ciphertext_base64>"

// Decrypt when reading
enc.decrypt(encryptedValue)
// → "+91-9876543210"
```
- **AES-256-GCM**: Provides both confidentiality and authentication
- **Unique IV per encryption**: Same plaintext produces different ciphertext
- **Auth tag**: Detects tampering (throws on modified ciphertext)

### 2. NoSQL Injection Prevention
```js
// Blocked: { username: { $gt: "" } }
// Blocked: { $where: "this.admin === true" }
// Blocked: { __proto__: { admin: true } }
```

### 3. Rate Limiting (Per-Route)
| Route | Limit | Window |
|-------|-------|--------|
| Auth  | 10 req | 15 min |
| Search | 200 req | 15 min |
| Booking create | 20 req | 1 hour |
| Payment | 5 req | 1 hour |
| Admin | 500 req | 15 min |
| Global | 100 req | 15 min |

### 4. GDPR Right to Erasure
```js
await userRepo.anonymize(userId);
// Sets: name → "Deleted User a1b2c3d4", email → "deleted_a1b2c3d4@removed.invalid"
```

---

## 📈 Scalability

### Cluster Mode
```bash
# Spawn 1 worker per CPU core (e.g., 8 cores = 8 Node.js processes)
CLUSTER_MODE=true npm start

# Rolling zero-downtime restart
kill -SIGUSR2 <master-pid>
```

### Connection Pooling
- MongoDB: **20 connections per process** (160 total on 8-core server)
- Redis: Persistent connection with retry strategy

### Cache Layers
1. **Nginx** (30s) — Shared across all Node.js processes
2. **Redis** (120s search, 300s entity) — Shared in-memory cache
3. **Repository** — Query-level memoization

---

## 🔌 Endpoints

| Category | Base Path | Description |
|----------|-----------|-------------|
| Search | `GET /api/v1/search/machines` | Filters + geo + text + pagination + facets |
| Autocomplete | `GET /api/v1/search/autocomplete?q=...` | Typeahead in < 100ms |
| Nearby | `GET /api/v1/search/nearby?lat=&lng=&radius=` | Geo-radius search |
| Filters | `GET /api/v1/search/filters` | Districts, types, price range |
| Health (liveness) | `GET /health` | < 10ms — for load balancers |
| Health (readiness) | `GET /health/detailed` | Full MongoDB + Redis + memory check |
| Metrics | `GET /health/metrics` | CPU, memory, pool, cache stats |

---

## 🚀 Quick Start

```bash
# Install
npm install

# Configure
cp .env.example .env
# Set MONGO_URI, REDIS_HOST, JWT_SECRET, FIELD_ENCRYPTION_KEY

# Run tests
npm test

# Start (single process / dev)
npm run dev

# Start (cluster / production)
CLUSTER_MODE=true npm start

# Run performance benchmark
npm start &
npm run benchmark
```

---

## ✅ Test Coverage

```
PASS tests/core.test.js
  SearchService            ✓ empty autocomplete for short queries
  EncryptionService        ✓ encrypt/decrypt ✓ unique IVs ✓ tamper detection
                           ✓ isEncrypted ✓ encryptFields ✓ hash consistency
  SanitizationService      ✓ XSS removal ✓ NoSQL injection ✓ __proto__
                           ✓ PII masking ✓ email/phone masking
  CacheManager             ✓ key builder ✓ deterministic search keys
                           ✓ PII exclusion ✓ stats structure
  CircuitBreakerService    ✓ opens on failures ✓ fallback invocation
  HealthCheckService       ✓ liveness structure ✓ memory check
  BaseRepository           ✓ instantiation ✓ modelName derivation
```
