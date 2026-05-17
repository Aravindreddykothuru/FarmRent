#!/usr/bin/env python3
"""
FarmRent LLM Integration Test Script
Test the new AI-powered farming assistance features
"""

import requests
import json
import time
from typing import Dict, Any

BASE_URL = "http://localhost:5001"

def test_health_check():
    """Test the health endpoint with LLM status"""
    print("🔍 Testing health check...")
    try:
        response = requests.get(f"{BASE_URL}/api/health")
        if response.status_code == 200:
            data = response.json()
            llm_status = data.get('llm_service', 'unknown')
            print(f"✅ Service healthy - LLM Status: {llm_status}")
            return True
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False

def test_equipment_recommendation():
    """Test AI-powered equipment recommendations"""
    print("\n🤖 Testing equipment recommendation...")

    payload = {
        "query": "I need to plow 30 acres of clay soil for corn planting next week",
        "context": {
            "farm_size": "medium",
            "soil_type": "clay",
            "crop": "corn",
            "season": "spring",
            "experience_level": "intermediate",
            "budget": "moderate"
        }
    }

    try:
        response = requests.post(f"{BASE_URL}/api/llm/equipment/recommend", json=payload)
        if response.status_code == 200:
            result = response.json()
            print("✅ Equipment recommendation received:"            print(f"   Equipment: {result.get('equipment', 'N/A')}")
            print(f"   Duration: {result.get('duration', 'N/A')}")
            print(f"   Cost: {result.get('estimated_cost', 'N/A')}")
            return True
        else:
            print(f"❌ Recommendation failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

def test_farming_analysis():
    """Test farming query analysis"""
    print("\n🧠 Testing farming query analysis...")

    payload = {
        "query": "How can I prevent soil erosion on my hilly farmland?",
        "user_context": {
            "location": "Appalachian region",
            "farm_size": "45 acres",
            "soil_type": "silt",
            "experience_level": "experienced"
        }
    }

    try:
        response = requests.post(f"{BASE_URL}/api/llm/farming/analyze", json=payload)
        if response.status_code == 200:
            result = response.json()
            print("✅ Farming analysis received:"            print(f"   Response length: {len(result.get('response', ''))} characters")
            return True
        else:
            print(f"❌ Analysis failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

def test_chat_support():
    """Test conversational AI support"""
    print("\n💬 Testing AI chat support...")

    payload = {
        "message": "I'm new to farming and need advice on getting started with a small vegetable garden",
        "context": "beginner_farming",
        "history": []
    }

    try:
        response = requests.post(f"{BASE_URL}/api/llm/chat", json=payload)
        if response.status_code == 200:
            result = response.json()
            print("✅ Chat response received:"            print(f"   Response preview: {result.get('response', '')[:100]}...")
            return True
        else:
            print(f"❌ Chat failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

def test_enhanced_risk_analysis():
    """Test enhanced risk analysis combining ML and LLM"""
    print("\n⚡ Testing enhanced risk analysis...")

    payload = {
        "user_data": {
            "user_id": 123,
            "account_age_days": 365,
            "total_bookings": 15,
            "successful_bookings": 14,
            "experience_level": "intermediate",
            "farm_size": "medium"
        },
        "transaction_data": {
            "equipment_type": "tractor",
            "rental_duration": 7,
            "estimated_value": 2500
        }
    }

    try:
        response = requests.post(f"{BASE_URL}/api/llm/risk/enhanced", json=payload)
        if response.status_code == 200:
            result = response.json()
            traditional = result.get('traditional_risk', {})
            combined = result.get('combined_score', 0)
            print("✅ Enhanced risk analysis received:"            print(".3f"            print(".3f"            return True
        else:
            print(f"❌ Risk analysis failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

def test_farming_plan_generation():
    """Test comprehensive farming plan generation"""
    print("\n📋 Testing farming plan generation...")

    payload = {
        "farm_details": {
            "size": "25 acres",
            "soil_type": "loamy",
            "location": "Midwest USA",
            "water_access": "good",
            "equipment_owned": ["small tractor"]
        },
        "season": "spring",
        "goals": ["maximize profit", "sustainable practices", "easy to manage"]
    }

    try:
        response = requests.post(f"{BASE_URL}/api/llm/farming/plan", json=payload)
        if response.status_code == 200:
            result = response.json()
            print("✅ Farming plan generated:"            print(f"   Plan length: {len(result.get('farming_plan', ''))} characters")
            return True
        else:
            print(f"❌ Plan generation failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

def main():
    """Run all LLM integration tests"""
    print("🚀 FarmRent LLM Integration Test Suite")
    print("=" * 50)

    if not test_health_check():
        print("\n❌ Cannot connect to Flask service. Make sure it's running on port 5001")
        return

    # Run all tests
    tests = [
        test_equipment_recommendation,
        test_farming_analysis,
        test_chat_support,
        test_enhanced_risk_analysis,
        test_farming_plan_generation
    ]

    passed = 0
    total = len(tests)

    for test in tests:
        if test():
            passed += 1
        time.sleep(1)  # Brief pause between tests

    print("\n" + "=" * 50)
    print(f"📊 Test Results: {passed}/{total} tests passed")

    if passed == total:
        print("🎉 All LLM features are working correctly!")
        print("\n💡 Your FarmRent platform now has AI-powered farming intelligence!")
    else:
        print(f"⚠️  {total - passed} tests failed. Check LLM service configuration.")

    print("\n🔗 Useful endpoints:")
    print("   Health: http://localhost:5001/api/health")
    print("   AI Chat: http://localhost:5001/api/llm/chat")
    print("   Equipment AI: http://localhost:5001/api/llm/equipment/recommend")
    print("\n📚 See LLM_INTEGRATION_README.md for detailed documentation")

if __name__ == "__main__":
    main()