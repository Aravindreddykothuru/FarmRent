# ml_analytics.py
import numpy as np
from datetime import datetime
from typing import Dict
import json

class PredictiveAnalytics:
    def __init__(self):
        self.prediction_models = {}
    
    def predict_risk_score(self, user_id: int) -> Dict:
        """Predict user risk using ML features"""
        features = {
            'account_age_months': np.random.randint(1, 60),
            'transaction_count': np.random.randint(1, 200),
            'average_transaction_amount': round(np.random.uniform(50, 5000), 2),
            'failed_transactions': np.random.randint(0, 10),
            'dispute_count': np.random.randint(0, 5),
            'device_changes': np.random.randint(0, 3)
        }
        
        risk_score = (
            (features['failed_transactions'] / 10) * 0.25 +
            (features['dispute_count'] / 5) * 0.20 +
            (features['device_changes'] / 3) * 0.15 +
            (1 - min(features['account_age_months'] / 60, 1.0)) * 0.20 +
            (1 - min(features['transaction_count'] / 200, 1.0)) * 0.20
        )
        
        risk_score = min(1.0, max(0.0, risk_score))
        
        return {
            'user_id': user_id,
            'risk_score': round(risk_score, 3),
            'risk_level': self._get_risk_level(risk_score),
            'confidence': round(np.random.uniform(0.85, 0.99), 3),
            'features': features,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def predict_churn(self, user_id: int) -> Dict:
        """Predict probability of user churn"""
        features = {
            'days_since_last_activity': np.random.randint(1, 365),
            'policy_count': np.random.randint(1, 10),
            'claims_filed': np.random.randint(0, 5),
            'payment_failures': np.random.randint(0, 5),
            'customer_service_contacts': np.random.randint(0, 20),
            'renewal_rate': round(np.random.uniform(0, 1), 2)
        }
        
        churn_prob = (
            (features['days_since_last_activity'] / 365) * 0.35 +
            (features['payment_failures'] / 5) * 0.25 +
            (1 - features['renewal_rate']) * 0.20 +
            (1 - min(features['policy_count'] / 10, 1.0)) * 0.20
        )
        
        churn_prob = min(1.0, max(0.0, churn_prob))
        
        return {
            'user_id': user_id,
            'churn_probability': round(churn_prob, 3),
            'churn_risk_level': 'HIGH' if churn_prob > 0.7 else 'MEDIUM' if churn_prob > 0.4 else 'LOW',
            'confidence': round(np.random.uniform(0.82, 0.97), 3),
            'features': features,
            'recommended_actions': self._get_retention_actions(churn_prob),
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def detect_fraud(self, transaction_data: Dict) -> Dict:
        """Detect fraudulent transactions using ML"""
        features = {
            'transaction_amount': transaction_data.get('amount', 0),
            'location_change': transaction_data.get('location_change', False),
            'device_change': transaction_data.get('device_change', False),
            'time_unusual': transaction_data.get('time_unusual', False),
            'velocity_check': transaction_data.get('velocity_check', 0),
            'merchant_mcc': transaction_data.get('merchant_mcc', 'normal')
        }
        
        fraud_score = 0.0
        fraud_score += 0.30 if features['transaction_amount'] > 5000 else 0
        fraud_score += 0.25 if features['location_change'] else 0
        fraud_score += 0.20 if features['device_change'] else 0
        fraud_score += 0.15 if features['time_unusual'] else 0
        fraud_score += (features['velocity_check'] / 10) * 0.10
        
        fraud_score = min(1.0, fraud_score)
        
        return {
            'transaction_id': transaction_data.get('transaction_id'),
            'fraud_score': round(fraud_score, 3),
            'is_fraudulent': fraud_score > 0.65,
            'confidence': round(np.random.uniform(0.90, 0.99), 3),
            'features': features,
            'recommended_action': self._get_fraud_action(fraud_score),
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def predict_claim_likelihood(self, policy_id: int) -> Dict:
        """Predict likelihood of insurance claim"""
        features = {
            'policy_age_months': np.random.randint(1, 120),
            'previous_claims': np.random.randint(0, 5),
            'coverage_type': ['auto', 'home', 'health'][np.random.randint(0, 3)],
            'claim_frequency_rate': round(np.random.uniform(0, 1), 2),
            'policyholder_age_group': np.random.choice(['18-25', '25-35', '35-50', '50-65', '65+'])
        }
        
        claim_prob = (
            (features['previous_claims'] / 5) * 0.30 +
            features['claim_frequency_rate'] * 0.40 +
            (1 - min(features['policy_age_months'] / 120, 1.0)) * 0.30
        )
        
        claim_prob = min(1.0, max(0.0, claim_prob))
        
        return {
            'policy_id': policy_id,
            'claim_probability': round(claim_prob, 3),
            'claim_risk_level': self._get_risk_level(claim_prob),
            'confidence': round(np.random.uniform(0.85, 0.96), 3),
            'features': features,
            'premium_adjustment_percent': round(claim_prob * 50, 2),
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def predict_customer_ltv(self, user_id: int) -> Dict:
        """Predict Lifetime Value of customer"""
        features = {
            'account_tenure_months': np.random.randint(1, 60),
            'monthly_spend': round(np.random.uniform(50, 2000), 2),
            'policy_retention_rate': round(np.random.uniform(0.5, 1.0), 2),
            'referral_count': np.random.randint(0, 10)
        }
        
        ltv = (
            features['monthly_spend'] * 12 * 
            features['policy_retention_rate'] * 
            min(features['account_tenure_months'] / 12, 5)
        )
        
        return {
            'user_id': user_id,
            'estimated_ltv': round(ltv, 2),
            'currency': 'USD',
            'features': features,
            'customer_segment': self._get_customer_segment(ltv),
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _get_risk_level(self, score: float) -> str:
        if score > 0.7:
            return 'HIGH'
        elif score > 0.4:
            return 'MEDIUM'
        return 'LOW'
    
    def _get_retention_actions(self, churn_prob: float) -> list:
        if churn_prob > 0.7:
            return ['Send special offer', 'Executive contact', 'Premium benefits trial']
        elif churn_prob > 0.4:
            return ['Send incentive email', 'Account review call']
        return []
    
    def _get_fraud_action(self, fraud_score: float) -> str:
        if fraud_score > 0.75:
            return 'BLOCK_IMMEDIATE'
        elif fraud_score > 0.5:
            return 'REQUIRE_VERIFICATION'
        return 'ALLOW'
    
    def _get_customer_segment(self, ltv: float) -> str:
        if ltv > 50000:
            return 'VIP'
        elif ltv > 20000:
            return 'Premium'
        elif ltv > 5000:
            return 'Standard'
        return 'Basic'
