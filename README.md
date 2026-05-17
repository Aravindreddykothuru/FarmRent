# 🌾 FarmRent — AI-Powered Farm Equipment Rental Platform

A next-generation farm machine rental platform featuring **Large Language Model (LLM) integration** for intelligent farming assistance. Four specialized layers work together to provide AI-enhanced equipment rental services.

| Layer | Tech | Port | Key Features |
|---|---|---|---|
| **Frontend** (`nextfrontend`) | Next.js + React + Tailwind | 3000 | Modern UI with AI chat integration |
| **Backend API** | Node.js + Express | 5000 | RESTful APIs with equipment management |
| **AI Enhancement Service** | Python + Flask + LLM | 5001 | **🤖 AI-powered farming intelligence** |
| **Cache** | Redis | 6379 | High-performance data caching |

---

## 🧠 AI-Powered Architecture

```
Browser
  └── Next.js Frontend (port 3000)
        ├── AI Chat Interface 🤖
        └── /api/* proxy
              └── Node.js Backend (port 5000)
                    ├── /api/v1/*  ← machines, bookings, auth (Node)
                    └── /api/v2/*  ← proxy → Flask AI Service (port 5001)
                                        ├── /api/llm/* 🤖 **NEW AI ENDPOINTS**
                                        │   ├── /equipment/recommend
                                        │   ├── /farming/analyze
                                        │   ├── /chat
                                        │   └── /insights/generate
                                        ├── /api/gps/*
                                        ├── /api/insurance/*
                                        ├── /api/payments/*
                                        └── /api/analytics/*
```

### 🤖 LLM Integration Features

**Instead of traditional APIs, farmers now interact with intelligent AI services:**

- **🗣️ Natural Language Equipment Recommendations**: "I need to plow 50 acres of clay soil"
- **💬 Conversational Farming Support**: AI chat assistant for farming questions
- **📊 Smart Analytics**: LLM-enhanced risk assessment and farming insights
- **📅 Intelligent Planning**: AI-generated farming operation plans
- **⚖️ Equipment Comparison**: Side-by-side analysis of rental options
- **🎯 Personalized Advice**: Context-aware farming recommendations

---

## Quick Start (Development)

### 1. Start Redis
```bash
# Docker (easiest)
docker run -d -p 6379:6379 redis:7-alpine

# Or install locally: https://redis.io/docs/install/
```

### 2. Configure AI Services
```bash
cd FutureEnhancement
# Copy environment template
cp .env.example .env

# Add your LLM API keys (choose one or both)
# OPENAI_API_KEY=sk-your-openai-key
# ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
```

### 3. Start Flask AI Service
```bash
cd FutureEnhancement
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
python app.py
# Runs on http://localhost:5001 with 🤖 AI capabilities
```

---

## Quick Start (Development)

### 1. Start Redis
```bash
# Docker (easiest)
docker run -d -p 6379:6379 redis:7-alpine

# Or install locally: https://redis.io/docs/install/
```

### 2. Start Flask Service
```bash
cd FutureEnhancement
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env        # then edit .env with your keys
python app.py
# Runs on http://localhost:5001
```

### 3. Start Node Backend
```bash
cd Backend
npm install
copy .env.example .env        # then edit .env
node server.js                # or: npm run dev (requires nodemon)
# Runs on http://localhost:5000
```

### 4. Start Frontend (Next.js — unified with API on same port)
```bash
cd nextfrontend
npm install
copy .env.example .env.local   # then edit if needed
npm run dev
# App + API → http://localhost:3000  (see nextfrontend/server.js)
```

---

## Docker Compose (all-in-one)

> Requires Dockerfiles in each service folder (see below).

```bash
# From the project root
docker compose up --build
```

Services:
- Frontend → http://localhost:3000
- Backend  → http://localhost:5000
- Flask    → http://localhost:5001
- Redis    → localhost:6379

---

## API Reference

### Node Backend — `/api/v1`

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Register user |
| POST | `/api/v1/auth/login` | Login, returns JWT |
| GET  | `/api/v1/machines` | Search/filter machines |
| POST | `/api/v1/bookings` | Create booking |
| GET  | `/api/v1/ml/recommendations` | ML machine recommendations |
| GET  | `/api/v1/ml/demand-prediction` | Demand forecast |
| POST | `/api/v1/ml/optimal-pricing` | Price recommendation |
| GET  | `/api/v1/ml/churn-risk` | Farmer churn analysis |

### Flask Micro-service — `/api/v2` (proxied through Node)

| Method | Path | Description |
|---|---|---|
| POST | `/api/v2/gps/log` | Log GPS location |
| GET  | `/api/v2/gps/current/:userId` | Get current location |
| GET  | `/api/v2/gps/route/:userId` | Get full route |
| POST | `/api/v2/gps/geofence` | Check geofence status |
| POST | `/api/v2/insurance/policy/create` | Create insurance policy |
| POST | `/api/v2/insurance/claim/create` | File a claim |
| POST | `/api/v2/payments/create` | Create Stripe payment intent |
| POST | `/api/v2/payments/refund` | Refund transaction |
| GET  | `/api/v2/analytics/risk/:userId` | ML risk score |
| GET  | `/api/v2/analytics/churn/:userId` | Churn prediction |
| POST | `/api/v2/analytics/fraud` | Fraud detection |
| GET  | `/api/v2/analytics/ltv/:userId` | Customer LTV |

### 🤖 AI/LLM Services — `/api/v2/llm` (NEW!)

| Method | Path | Description | AI Feature |
|---|---|---|---|
| POST | `/api/v2/llm/equipment/recommend` | **Smart equipment recommendations** | 🤖 Natural language processing |
| POST | `/api/v2/llm/farming/analyze` | **Farming query analysis** | 🧠 Intelligent advice |
| POST | `/api/v2/llm/chat` | **Conversational support** | 💬 Chat with farming AI |
| POST | `/api/v2/llm/booking/assist` | **Booking assistance** | 📅 Smart scheduling |
| POST | `/api/v2/llm/risk/enhanced` | **Enhanced risk analysis** | ⚡ AI + ML combined |
| POST | `/api/v2/llm/insights/generate` | **Personalized insights** | 📊 Farming intelligence |
| POST | `/api/v2/llm/equipment/compare` | **Equipment comparison** | ⚖️ Side-by-side analysis |
| POST | `/api/v2/llm/farming/plan` | **Farming operation plans** | 📋 AI planning |

### Health checks
```bash
curl http://localhost:5000/health     # Node
curl http://localhost:5001/api/health # Flask (shows LLM status)
curl http://localhost:5000/api/v2/health # Flask via Node proxy
```

---

## 🤖 Using LLM Features

### Equipment Recommendation Example
```bash
curl -X POST http://localhost:5001/api/llm/equipment/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "query": "I need to harvest 20 acres of wheat",
    "context": {
      "farm_size": "small",
      "crop": "wheat",
      "terrain": "flat",
      "experience": "beginner"
    }
  }'
```

### AI Chat Support
```bash
curl -X POST http://localhost:5001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How do I maintain my tractor?",
    "context": "equipment_maintenance"
  }'
```

### Farming Plan Generation
```bash
curl -X POST http://localhost:5001/api/llm/farming/plan \
  -H "Content-Type: application/json" \
  -d '{
    "farm_details": {
      "size": "50 acres",
      "soil_type": "loamy",
      "location": "Midwest USA"
    },
    "season": "spring",
    "goals": ["maximize yield", "minimize costs"]
  }'
```

---

## Environment Variables

### Backend (`Backend/.env`)
See [`Backend/.env.example`](Backend/.env.example)

### Flask (`FutureEnhancement/.env`)
See [`FutureEnhancement/.env.example`](FutureEnhancement/.env.example)

### Frontend (`nextfrontend/.env.local`)
See [`nextfrontend/.env.example`](nextfrontend/.env.example)

---

## Frontend API Usage

```typescript
import { machines, bookings, gps, insurance, payments, mlNode } from '@/lib/api';

// Get machine recommendations
const recs = await mlNode.getRecommendations({ cropType: 'rice', district: 'Guntur' });

// Log GPS location
await gps.logLocation({ user_id: 1, latitude: 16.5, longitude: 80.6 });

// Create insurance policy
await insurance.createPolicy({ user_id: 1, policy_type: 'premium', ... });

// Process payment
const result = await payments.createPayment({ user_id: 1, amount: 1500 });
```
