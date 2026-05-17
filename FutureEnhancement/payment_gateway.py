# payment_gateway.py
import stripe
import os
from datetime import datetime
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

class PaymentGateway:
    def __init__(self):
        self.api_key = os.getenv('STRIPE_SECRET_KEY')
        stripe.api_key = self.api_key
    
    def process_payment(self, user_id: int, amount: float, 
                       currency: str = 'usd', payment_method: str = 'card') -> Dict:
        try:
            intent = stripe.PaymentIntent.create(
                amount=int(amount * 100),
                currency=currency.lower(),
                payment_method_types=[payment_method],
                metadata={'user_id': user_id}
            )
            return {
                'success': True,
                'transaction_id': intent.id,
                'amount': amount,
                'status': intent.status,
                'client_secret': intent.client_secret
            }
        except stripe.error.CardError as e:
            return {'success': False, 'message': f"Card declined: {e.user_message}"}
        except Exception as e:
            logger.error(f"Payment error: {str(e)}")
            return {'success': False, 'message': str(e)}
    
    def process_refund(self, transaction_id: str, amount: float = None) -> Dict:
        try:
            refund_params = {'payment_intent': transaction_id}
            if amount:
                refund_params['amount'] = int(amount * 100)
            refund = stripe.Refund.create(**refund_params)
            return {'success': True, 'refund_id': refund.id, 'status': refund.status}
        except Exception as e:
            return {'success': False, 'message': str(e)}
    
    def validate_card(self, card_token: str) -> Dict:
        try:
            payment_method = stripe.PaymentMethod.retrieve(card_token)
            card = payment_method.card
            return {
                'valid': True,
                'brand': card.brand,
                'last4': card.last4,
                'exp_month': card.exp_month,
                'exp_year': card.exp_year
            }
        except Exception:
            return {'valid': False}
    
    def create_subscription(self, customer_id: str, price_id: str) -> Dict:
        try:
            subscription = stripe.Subscription.create(
                customer=customer_id,
                items=[{'price': price_id}]
            )
            return {
                'success': True,
                'subscription_id': subscription.id,
                'status': subscription.status
            }
        except Exception as e:
            return {'success': False, 'message': str(e)}
