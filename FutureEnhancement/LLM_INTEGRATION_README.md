# FarmRent LLM Integration Guide

## Overview

FarmRent has been enhanced with Large Language Model (LLM) capabilities to provide intelligent, conversational farming assistance. Instead of traditional API-driven interactions, farmers can now engage with AI-powered services for equipment recommendations, farming advice, booking assistance, and personalized insights.

## Architecture Changes

### Before (API-Centric)
```
Frontend → Backend APIs → Database/Traditional ML
```

### After (LLM-Enhanced)
```
Frontend → LLM Services → Intelligent Analysis → Backend APIs → Database
```

## LLM Services Available

### 1. Equipment Recommendation Engine
**Endpoint:** `POST /api/llm/equipment/recommend`

Recommends farming equipment based on natural language queries and farming context.

**Example Request:**
```json
{
  "query": "I need to plow 50 acres of clay soil for wheat planting",
  "context": {
    "farm_size": "medium",
    "soil_type": "clay",
    "crop": "wheat",
    "season": "spring",
    "budget": "moderate"
  }
}
```

**Response:**
```json
{
  "equipment": "Heavy-Duty Tractor with Plow Attachment",
  "reasoning": "Clay soil requires significant power for effective plowing...",
  "duration": "3-5 days",
  "estimated_cost": "$800-1200",
  "safety_notes": "Ensure proper training and use rollover protection...",
  "alternatives": ["Compact Tractor", "Hire Professional Service"]
}
```

### 2. Farming Query Analysis
**Endpoint:** `POST /api/llm/farming/analyze`

Provides intelligent analysis and advice for farming-related questions.

**Example Request:**
```json
{
  "query": "How do I prevent soil erosion on my hillside farm?",
  "user_context": {
    "location": "Appalachian region",
    "farm_size": "25 acres",
    "soil_type": "silt",
    "experience_level": "intermediate"
  }
}
```

### 3. Conversational Support Chat
**Endpoint:** `POST /api/llm/chat`

AI-powered chat support for farmers with conversation memory.

**Example Request:**
```json
{
  "message": "I need help choosing between renting a combine or hiring a custom harvester",
  "history": [
    {"role": "user", "content": "I'm farming 100 acres of corn"},
    {"role": "assistant", "content": "That's a substantial operation..."}
  ],
  "context": "equipment_selection"
}
```

### 4. Enhanced Risk Analysis
**Endpoint:** `POST /api/llm/risk/enhanced`

Combines traditional ML risk scoring with LLM contextual analysis.

**Response:**
```json
{
  "traditional_risk": {
    "risk_score": 0.35,
    "risk_level": "Low",
    "features": {...}
  },
  "llm_enhanced": {
    "analysis": "Based on farming experience and equipment handling...",
    "mitigation_recommendations": [...]
  },
  "combined_score": 0.42
}
```

### 5. Personalized Farming Insights
**Endpoint:** `POST /api/llm/insights/generate`

Generates actionable farming insights based on user history and patterns.

### 6. Equipment Comparison
**Endpoint:** `POST /api/llm/equipment/compare`

Compares multiple equipment options with detailed analysis.

### 7. Comprehensive Farming Plans
**Endpoint:** `POST /api/llm/farming/plan`

Creates detailed farming operation plans with equipment recommendations.

## Setup Instructions

### 1. Install Dependencies
```bash
cd FutureEnhancement
pip install -r requirements.txt
```

### 2. Configure API Keys
Copy `.env.example` to `.env` and add your LLM API keys:

```bash
# Choose one or both LLM providers
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
```

### 3. Start Services
```bash
# Start Flask service with LLM capabilities
python app.py
```

## Integration with Frontend

### React Component Example
```jsx
import { useState } from 'react';

function EquipmentRecommendation() {
  const [query, setQuery] = useState('');
  const [recommendation, setRecommendation] = useState(null);

  const getRecommendation = async () => {
    const response = await fetch('/api/v1/llm/equipment/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        context: { farm_size: 'medium', soil_type: 'loamy' }
      })
    });
    const result = await response.json();
    setRecommendation(result);
  };

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Describe your farming needs..."
      />
      <button onClick={getRecommendation}>Get AI Recommendation</button>
      {recommendation && (
        <div>
          <h3>Recommended: {recommendation.equipment}</h3>
          <p>{recommendation.reasoning}</p>
          <p>Cost: {recommendation.estimated_cost}</p>
        </div>
      )}
    </div>
  );
}
```

## Benefits of LLM Integration

### For Farmers:
- **Natural Language Interaction**: Ask questions in plain English
- **Personalized Recommendations**: AI considers farm specifics, experience, and goals
- **Proactive Insights**: Receive farming tips and optimization suggestions
- **24/7 Support**: Always-available intelligent assistance

### For FarmRent Platform:
- **Improved User Experience**: More intuitive and helpful interactions
- **Higher Conversion Rates**: Better equipment recommendations lead to more rentals
- **Reduced Support Load**: AI handles common questions and guidance
- **Data-Driven Insights**: LLM analysis provides deeper understanding of user needs

## Fallback Mechanisms

If LLM services are unavailable, the system gracefully falls back to:
- Traditional ML-based recommendations
- Rule-based equipment suggestions
- Standard customer support workflows

## Monitoring and Analytics

The LLM service includes:
- Response quality tracking
- User satisfaction metrics
- Performance monitoring
- Fallback usage statistics

## Future Enhancements

Planned LLM features:
- **Voice Interaction**: Natural speech-to-speech farming assistance
- **Image Analysis**: Equipment condition assessment from photos
- **Predictive Maintenance**: AI-powered equipment health monitoring
- **Market Intelligence**: Real-time farming commodity and equipment pricing
- **Weather Integration**: AI-powered weather impact analysis for farming decisions

## API Reference

All LLM endpoints are available under `/api/llm/` and accept JSON payloads with appropriate context data. Responses include timestamps, confidence scores, and fallback indicators when applicable.