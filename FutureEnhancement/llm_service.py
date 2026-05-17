# llm_service.py - LLM Integration for FarmRent Platform
import os
import json
from typing import Dict, List, Optional, Any
from datetime import datetime
try:
    from langchain_openai import ChatOpenAI
    from langchain_anthropic import ChatAnthropic
    from langchain.prompts import PromptTemplate
    from langchain.chains import LLMChain
    from langchain.memory import ConversationBufferMemory
    from langchain.schema import HumanMessage, AIMessage
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    ChatOpenAI = None
    ChatAnthropic = None
    PromptTemplate = None
    LLMChain = None
    ConversationBufferMemory = None
import logging

logger = logging.getLogger(__name__)

class FarmLLMService:
    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        self.anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
        self.default_llm = None
        self.llms = {}
        self.memories = {}

        if LANGCHAIN_AVAILABLE:
            if self.openai_api_key:
                self.llms['openai'] = ChatOpenAI(
                    model="gpt-4-turbo-preview",
                    temperature=0.7,
                    api_key=self.openai_api_key
                )
            if self.anthropic_api_key:
                self.llms['anthropic'] = ChatAnthropic(
                    model="claude-3-sonnet-20240229",
                    temperature=0.7,
                    api_key=self.anthropic_api_key
                )

            # Use OpenAI as default if available
            self.default_llm = self.llms.get('openai') or self.llms.get('anthropic')

            # Initialize conversation memories for different contexts
            self.memories = {
                'equipment_recommendation': ConversationBufferMemory(),
                'farming_advice': ConversationBufferMemory(),
                'booking_assistance': ConversationBufferMemory(),
                'general_support': ConversationBufferMemory()
            }

        # Load farming knowledge base
        self.farming_knowledge = self._load_farming_knowledge()

    def _load_farming_knowledge(self) -> Dict:
        """Load farming domain knowledge for better context"""
        return {
            'crops': [
                'wheat', 'rice', 'corn', 'soybeans', 'cotton', 'sugarcane',
                'potatoes', 'tomatoes', 'lettuce', 'carrots', 'onions'
            ],
            'equipment_types': [
                'tractor', 'harvester', 'plow', 'seeder', 'sprayer',
                'cultivator', 'baler', 'tiller', 'drill', 'combine'
            ],
            'seasons': ['spring', 'summer', 'fall', 'winter'],
            'soil_types': ['clay', 'sandy', 'loamy', 'silt', 'chalky'],
            'farming_practices': [
                'crop rotation', 'no-till farming', 'precision agriculture',
                'organic farming', 'hydroponics', 'aquaponics'
            ]
        }

    def recommend_equipment(self, query: str, context: Dict = None) -> Dict:
        """Recommend farming equipment based on natural language query"""
        if not self.default_llm:
            return {"error": "No LLM available", "fallback": "basic_recommendation"}

        prompt = f"""
        You are an expert agricultural equipment consultant for FarmRent platform.
        Based on the farmer's query and context, recommend the most suitable equipment.

        Farmer Query: {query}

        Context: {json.dumps(context or {}, indent=2)}

        Available Equipment Types: {', '.join(self.farming_knowledge['equipment_types'])}

        Consider:
        - Type of farming operation
        - Scale of operation (small, medium, large farm)
        - Terrain and soil conditions
        - Season and crop type
        - Budget considerations
        - Equipment availability and rental costs

        Provide a detailed recommendation including:
        1. Recommended equipment
        2. Why this equipment is suitable
        3. Estimated rental duration and cost
        4. Safety considerations
        5. Alternative options if applicable

        Respond in JSON format with keys: equipment, reasoning, duration, estimated_cost, safety_notes, alternatives
        """

        try:
            response = self.default_llm.predict(prompt)
            # Parse JSON response
            result = json.loads(response.strip())
            result['timestamp'] = datetime.utcnow().isoformat()
            result['query'] = query
            return result
        except Exception as e:
            logger.error(f"LLM recommendation error: {e}")
            return self._fallback_equipment_recommendation(query, context)

    def _fallback_equipment_recommendation(self, query: str, context: Dict = None) -> Dict:
        """Fallback recommendation when LLM is unavailable"""
        return {
            "equipment": "General Purpose Tractor",
            "reasoning": "Standard recommendation when AI analysis is unavailable",
            "duration": "1-7 days",
            "estimated_cost": "$200-500/day",
            "safety_notes": "Always wear appropriate safety gear and follow manufacturer guidelines",
            "alternatives": ["Compact Tractor", "Utility Vehicle"],
            "fallback": True,
            "timestamp": datetime.utcnow().isoformat()
        }

    def analyze_farming_query(self, query: str, user_context: Dict = None) -> Dict:
        """Analyze farming-related queries and provide intelligent responses"""
        if not self.default_llm:
            return {"error": "No LLM available", "response": "Basic farming assistance"}

        prompt = f"""
        You are a knowledgeable farming assistant for the FarmRent platform.
        Analyze this farming query and provide helpful, accurate information.

        User Query: {query}

        User Context: {json.dumps(user_context or {}, indent=2)}

        Farming Knowledge Base:
        - Crops: {', '.join(self.farming_knowledge['crops'])}
        - Equipment: {', '.join(self.farming_knowledge['equipment_types'])}
        - Practices: {', '.join(self.farming_knowledge['farming_practices'])}

        Provide a comprehensive response that includes:
        1. Understanding of the query
        2. Relevant farming advice or information
        3. Equipment recommendations if applicable
        4. Best practices or tips
        5. Any safety considerations
        6. Suggestions for FarmRent services if relevant

        Keep the response conversational, helpful, and practical for farmers.
        """

        try:
            response = self.default_llm.predict(prompt)
            return {
                "query": query,
                "response": response.strip(),
                "analyzed_at": datetime.utcnow().isoformat(),
                "confidence": "high" if len(response.strip()) > 100 else "medium"
            }
        except Exception as e:
            logger.error(f"LLM analysis error: {e}")
            return {
                "query": query,
                "response": "I'm here to help with your farming questions. Please try rephrasing your query.",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }

    def generate_booking_assistance(self, equipment_type: str, duration: int, user_profile: Dict = None) -> Dict:
        """Generate intelligent booking assistance and recommendations"""
        if not self.default_llm:
            return {"error": "No LLM available"}

        prompt = f"""
        You are a booking assistant for FarmRent platform. Help users make informed equipment rental decisions.

        Equipment Type: {equipment_type}
        Requested Duration: {duration} days

        User Profile: {json.dumps(user_profile or {}, indent=2)}

        Provide booking assistance including:
        1. Equipment suitability assessment
        2. Duration recommendations
        3. Cost breakdown and potential savings
        4. Preparation checklist
        5. Usage tips and safety reminders
        6. Alternative equipment suggestions
        7. Maintenance and return instructions

        Make the response practical and user-friendly.
        """

        try:
            response = self.default_llm.predict(prompt)
            return {
                "equipment_type": equipment_type,
                "requested_duration": duration,
                "assistance": response.strip(),
                "generated_at": datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"LLM booking assistance error: {e}")
            return {
                "equipment_type": equipment_type,
                "assistance": "Standard booking assistance available. Please contact support for detailed guidance.",
                "error": str(e)
            }

    def analyze_risk_with_llm(self, user_data: Dict, transaction_data: Dict = None) -> Dict:
        """Enhanced risk analysis using LLM for better context understanding"""
        if not self.default_llm:
            return {"error": "No LLM available", "risk_score": 0.5}

        prompt = f"""
        You are a risk assessment AI for FarmRent platform. Analyze user and transaction data to assess rental risk.

        User Data: {json.dumps(user_data, indent=2)}
        Transaction Data: {json.dumps(transaction_data or {}, indent=2)}

        Consider these risk factors:
        - User experience and history
        - Equipment type and value
        - Rental duration and cost
        - Location and usage context
        - Weather conditions
        - Seasonal farming patterns
        - Equipment maintenance history

        Provide a risk assessment including:
        1. Overall risk score (0.0-1.0)
        2. Risk level (Low/Medium/High)
        3. Key risk factors identified
        4. Mitigation recommendations
        5. Suggested security deposits or requirements

        Be thorough but fair in your assessment.
        """

        try:
            response = self.default_llm.predict(prompt)
            # Parse and structure the response
            return {
                "llm_analysis": response.strip(),
                "enhanced": True,
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"LLM risk analysis error: {e}")
            return {
                "error": str(e),
                "fallback": True,
                "timestamp": datetime.utcnow().isoformat()
            }

    def generate_farming_insights(self, user_history: List[Dict], weather_data: Dict = None) -> Dict:
        """Generate personalized farming insights using LLM"""
        if not self.default_llm:
            return {"error": "No LLM available"}

        prompt = f"""
        You are an agricultural insights AI for FarmRent platform. Analyze user farming history and provide valuable insights.

        User History: {json.dumps(user_history[-10:], indent=2)}  # Last 10 activities
        Weather Data: {json.dumps(weather_data or {}, indent=2)}

        Generate insights including:
        1. Farming pattern analysis
        2. Equipment usage optimization suggestions
        3. Seasonal recommendations
        4. Cost-saving opportunities
        5. Productivity improvement tips
        6. Upcoming farming season preparation
        7. Equipment maintenance predictions

        Make insights actionable and specific to the user's farming context.
        """

        try:
            response = self.default_llm.predict(prompt)
            return {
                "insights": response.strip(),
                "generated_at": datetime.utcnow().isoformat(),
                "data_points_analyzed": len(user_history)
            }
        except Exception as e:
            logger.error(f"LLM insights error: {e}")
            return {
                "insights": "Basic farming insights available through traditional analytics.",
                "error": str(e)
            }

    def chat_support(self, message: str, conversation_history: List[Dict] = None, context: str = "general") -> Dict:
        """Conversational AI support for farmers"""
        if not self.default_llm:
            return {"error": "No LLM available", "response": "Support chat temporarily unavailable"}

        memory = self.memories.get(context, self.memories['general_support'])

        # Add conversation history to memory
        if conversation_history:
            for msg in conversation_history[-5:]:  # Keep last 5 messages
                if msg.get('role') == 'user':
                    memory.chat_memory.add_user_message(msg.get('content', ''))
                elif msg.get('role') == 'assistant':
                    memory.chat_memory.add_ai_message(msg.get('content', ''))

        prompt = f"""
        You are a helpful farming assistant for FarmRent platform. Engage in natural conversation with farmers.

        Current Context: {context}
        User Message: {message}

        Available Services:
        - Equipment rental and recommendations
        - Farming advice and best practices
        - Booking assistance
        - Technical support
        - Weather-related guidance
        - Seasonal farming tips

        Respond naturally and helpfully. Keep responses concise but informative.
        If the user needs specific FarmRent services, guide them appropriately.
        """

        try:
            chain = LLMChain(llm=self.default_llm, prompt=PromptTemplate.from_template(prompt), memory=memory)
            response = chain.run(message=message)

            return {
                "response": response.strip(),
                "context": context,
                "timestamp": datetime.utcnow().isoformat(),
                "conversation_id": f"{context}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
            }
        except Exception as e:
            logger.error(f"LLM chat error: {e}")
            return {
                "response": "I'm experiencing technical difficulties. Please try again or contact support.",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }