# app.py - Flask Micro-service for FutureEnhancement features
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager, create_access_token, jwt_required
from flask_cors import CORS
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

load_dotenv()

from payment_gateway import PaymentGateway
from gps_tracking import GPSTracker
from insurance_module import InsuranceModule
from ml_analytics import PredictiveAnalytics
from llm_service import FarmLLMService

app = Flask(__name__)
CORS(app)  # Allow requests from Node backend proxy

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///app.db')
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'change-this-in-production')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db = SQLAlchemy(app)
jwt = JWTManager(app)

# Initialize modules
payment_gateway = PaymentGateway()
gps_tracker = GPSTracker()
insurance_module = InsuranceModule()
ml_analytics = PredictiveAnalytics()
llm_service = FarmLLMService()

# LLM configuration flags
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
LLM_CONFIGURED = bool((OPENAI_API_KEY or ANTHROPIC_API_KEY) and llm_service.default_llm)

# ==================== ROUTES ====================

@app.route('/api/health', methods=['GET'])
def health_check():
    # Check LLM service availability
    llm_status = "available" if LLM_CONFIGURED else "disabled"

    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '2.0.0',  # Updated version with LLM integration
        'service': 'flask-future-enhancement',
        'llm_service': llm_status,
        'modules': {
            'payment_gateway': 'active',
            'gps_tracker': 'active',
            'insurance_module': 'active',
            'ml_analytics': 'active',
            'llm_service': llm_status
        }
    }), 200

# ─── PAYMENT ROUTES ───────────────────────────────────────────────────────────
@app.route('/api/payments/create', methods=['POST'])
def create_payment():
    data = request.get_json()
    result = payment_gateway.process_payment(
        data['user_id'],
        data['amount'],
        data.get('currency', 'usd')
    )
    return jsonify(result), (200 if result['success'] else 400)

@app.route('/api/payments/refund', methods=['POST'])
def refund_payment():
    data = request.get_json()
    result = payment_gateway.process_refund(data['transaction_id'])
    return jsonify(result), (200 if result['success'] else 400)

@app.route('/api/payments/validate-card', methods=['POST'])
def validate_card():
    data = request.get_json()
    result = payment_gateway.validate_card(data['card_token'])
    return jsonify(result), 200

@app.route('/api/payments/subscribe', methods=['POST'])
def create_subscription():
    data = request.get_json()
    result = payment_gateway.create_subscription(data['customer_id'], data['price_id'])
    return jsonify(result), (200 if result['success'] else 400)

# ─── GPS ROUTES ────────────────────────────────────────────────────────────────
@app.route('/api/gps/log', methods=['POST'])
def log_location():
    data = request.get_json()
    result = gps_tracker.track_location(
        data['user_id'],
        data['latitude'],
        data['longitude'],
        data.get('altitude'),
        data.get('speed')
    )
    return jsonify(result), 201

@app.route('/api/gps/current/<int:user_id>', methods=['GET'])
def get_current_location(user_id):
    location = gps_tracker.get_current_location(user_id)
    return jsonify(location), (200 if location else 404)

@app.route('/api/gps/route/<int:user_id>', methods=['GET'])
def get_user_route(user_id):
    route = gps_tracker.get_route(user_id)
    return jsonify({'route': route}), 200

@app.route('/api/gps/distance/<int:user_id>', methods=['GET'])
def get_distance(user_id):
    route = gps_tracker.get_route(user_id)
    distance = gps_tracker.calculate_distance(route)
    avg_speed = gps_tracker.calculate_average_speed(route)
    return jsonify({'distance_km': distance, 'avg_speed_kmh': avg_speed}), 200

@app.route('/api/gps/geofence', methods=['POST'])
def check_geofence():
    data = request.get_json()
    result = gps_tracker.get_geofence_status(
        data['user_id'],
        data['center_lat'],
        data['center_lon'],
        data['radius_km']
    )
    return jsonify(result), 200

# ─── INSURANCE ROUTES ──────────────────────────────────────────────────────────
@app.route('/api/insurance/policy/create', methods=['POST'])
def create_policy():
    data = request.get_json()
    policy = insurance_module.create_policy(
        data['user_id'],
        data['policy_type'],
        data['coverage_amount'],
        data['premium_amount'],
        data['start_date'],
        data['end_date']
    )
    return jsonify(policy), 201

@app.route('/api/insurance/claim/create', methods=['POST'])
def create_claim():
    data = request.get_json()
    claim = insurance_module.create_claim(
        data['policy_number'],
        data['description'],
        data['amount_claimed']
    )
    return jsonify(claim), 201

@app.route('/api/insurance/claim/approve', methods=['POST'])
def approve_claim():
    data = request.get_json()
    result = insurance_module.approve_claim(data['claim_number'])
    return jsonify(result), 200

@app.route('/api/insurance/policy/risk', methods=['PUT'])
def update_risk():
    data = request.get_json()
    result = insurance_module.update_policy_risk(
        data['policy_number'],
        data['risk_score']
    )
    return jsonify(result), 200

# ─── ANALYTICS ROUTES ──────────────────────────────────────────────────────────
@app.route('/api/analytics/risk/<int:user_id>', methods=['GET'])
def get_risk_assessment(user_id):
    result = ml_analytics.predict_risk_score(user_id)
    return jsonify(result), 200

@app.route('/api/analytics/churn/<int:user_id>', methods=['GET'])
def get_churn_prediction(user_id):
    result = ml_analytics.predict_churn(user_id)
    return jsonify(result), 200

@app.route('/api/analytics/fraud', methods=['POST'])
def detect_fraud():
    data = request.get_json()
    result = ml_analytics.detect_fraud(data.get('transaction_data', {}))
    return jsonify(result), 200

@app.route('/api/analytics/claim/<int:policy_id>', methods=['GET'])
def get_claim_likelihood(policy_id):
    result = ml_analytics.predict_claim_likelihood(policy_id)
    return jsonify(result), 200

@app.route('/api/analytics/ltv/<int:user_id>', methods=['GET'])
def get_ltv(user_id):
    result = ml_analytics.predict_customer_ltv(user_id)
    return jsonify(result), 200

# ─── LLM ENHANCED ROUTES ───────────────────────────────────────────────────────
@app.route('/api/llm/equipment/recommend', methods=['POST'])
def recommend_equipment():
    """LLM-powered equipment recommendations"""
    if not LLM_CONFIGURED:
        return jsonify({
            "status": "disabled",
            "message": "LLM service not configured"
        }), 200
    data = request.get_json()
    query = data.get('query', '')
    context = data.get('context', {})

    result = llm_service.recommend_equipment(query, context)
    return jsonify(result), 200

@app.route('/api/llm/farming/analyze', methods=['POST'])
def analyze_farming_query():
    """LLM-powered farming query analysis"""
    if not LLM_CONFIGURED:
        return jsonify({
            "status": "disabled",
            "message": "LLM service not configured"
        }), 200
    data = request.get_json()
    query = data.get('query', '')
    user_context = data.get('user_context', {})

    result = llm_service.analyze_farming_query(query, user_context)
    return jsonify(result), 200

@app.route('/api/llm/booking/assist', methods=['POST'])
def booking_assistance():
    """LLM-powered booking assistance"""
    if not LLM_CONFIGURED:
        return jsonify({
            "status": "disabled",
            "message": "LLM service not configured"
        }), 200
    data = request.get_json()
    equipment_type = data.get('equipment_type', '')
    duration = data.get('duration', 1)
    user_profile = data.get('user_profile', {})

    result = llm_service.generate_booking_assistance(equipment_type, duration, user_profile)
    return jsonify(result), 200

@app.route('/api/llm/chat', methods=['POST'])
def chat_support():
    """Conversational AI support for farmers"""
    if not LLM_CONFIGURED:
        return jsonify({
            "status": "disabled",
            "message": "LLM service not configured"
        }), 200
    data = request.get_json()
    message = data.get('message', '')
    conversation_history = data.get('history', [])
    context = data.get('context', 'general')

    result = llm_service.chat_support(message, conversation_history, context)
    return jsonify(result), 200

@app.route('/api/llm/risk/enhanced', methods=['POST'])
def enhanced_risk_analysis():
    """LLM-enhanced risk analysis"""
    if not LLM_CONFIGURED:
        return jsonify({
            "status": "disabled",
            "message": "LLM service not configured"
        }), 200
    data = request.get_json()
    user_data = data.get('user_data', {})
    transaction_data = data.get('transaction_data', {})

    # Get traditional ML risk score
    ml_risk = ml_analytics.predict_risk_score(user_data.get('user_id', 0))

    # Get LLM-enhanced analysis
    llm_analysis = llm_service.analyze_risk_with_llm(user_data, transaction_data)

    # Combine results
    result = {
        'traditional_risk': ml_risk,
        'llm_enhanced': llm_analysis,
        'combined_score': (ml_risk['risk_score'] + (llm_analysis.get('risk_score', 0.5))) / 2,
        'timestamp': datetime.utcnow().isoformat()
    }

    return jsonify(result), 200

@app.route('/api/llm/insights/generate', methods=['POST'])
def generate_farming_insights():
    """Generate personalized farming insights using LLM"""
    data = request.get_json()
    user_history = data.get('user_history', [])
    weather_data = data.get('weather_data', {})

    result = llm_service.generate_farming_insights(user_history, weather_data)
    return jsonify(result), 200

@app.route('/api/llm/equipment/compare', methods=['POST'])
def compare_equipment():
    """LLM-powered equipment comparison"""
    data = request.get_json()
    equipment_options = data.get('equipment_options', [])
    farming_context = data.get('farming_context', {})

    if not equipment_options:
        return jsonify({'error': 'No equipment options provided'}), 400

    prompt = f"""
    Compare these farming equipment options for the given context:

    Equipment Options: {json.dumps(equipment_options, indent=2)}
    Farming Context: {json.dumps(farming_context, indent=2)}

    Provide a detailed comparison including:
    1. Best overall choice and why
    2. Pros and cons of each option
    3. Cost-benefit analysis
    4. Suitability for different farm sizes
    5. Maintenance considerations
    6. Recommendations based on farming context
    """

    if llm_service.default_llm:
        response = llm_service.default_llm.predict(prompt)
        result = {
            'comparison': response.strip(),
            'options_analyzed': len(equipment_options),
            'context': farming_context,
            'timestamp': datetime.utcnow().isoformat()
        }
    else:
        result = {
            'error': 'LLM service unavailable',
            'basic_comparison': f'Comparing {len(equipment_options)} equipment options',
            'timestamp': datetime.utcnow().isoformat()
        }

    return jsonify(result), 200

@app.route('/api/llm/farming/plan', methods=['POST'])
def generate_farming_plan():
    """Generate comprehensive farming plans using LLM"""
    data = request.get_json()
    farm_details = data.get('farm_details', {})
    season = data.get('season', 'current')
    goals = data.get('goals', [])

    prompt = f"""
    Create a comprehensive farming plan based on the following details:

    Farm Details: {json.dumps(farm_details, indent=2)}
    Season: {season}
    Goals: {json.dumps(goals, indent=2)}

    Generate a detailed farming plan including:
    1. Crop selection and rotation recommendations
    2. Equipment needs and scheduling
    3. Timeline with key milestones
    4. Resource requirements (seeds, fertilizers, etc.)
    5. Risk mitigation strategies
    6. Expected yields and ROI projections
    7. FarmRent equipment rental recommendations
    8. Seasonal preparation checklist

    Make the plan practical, realistic, and tailored to the farm's specifics.
    """

    if llm_service.default_llm:
        response = llm_service.default_llm.predict(prompt)
        result = {
            'farming_plan': response.strip(),
            'farm_details': farm_details,
            'season': season,
            'goals': goals,
            'generated_at': datetime.utcnow().isoformat()
        }
    else:
        result = {
            'error': 'LLM service unavailable',
            'basic_plan': 'Standard farming planning available through traditional methods',
            'timestamp': datetime.utcnow().isoformat()
        }

    return jsonify(result), 200

# ─── ERROR HANDLERS ────────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    port = int(os.getenv('FLASK_PORT', 5001))
    debug = os.getenv('FLASK_ENV', 'development') == 'development'
    app.run(debug=debug, host='0.0.0.0', port=port)
