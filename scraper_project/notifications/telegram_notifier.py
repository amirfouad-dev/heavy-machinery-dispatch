import os
import requests
import logging

logger = logging.getLogger(__name__)

class TelegramNotifier:
    def __init__(self):
        self.bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')

    def send_text(self, chat_id, text, parse_mode=None):
        """Send a text message (operational alerts, digests). Pass
        parse_mode='Markdown' to render *bold* etc."""
        if not self.bot_token or not chat_id:
            logger.warning("Telegram credentials or target chat ID not configured. Skipping message.")
            return False
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        payload = {'chat_id': chat_id, 'text': text}
        if parse_mode:
            payload['parse_mode'] = parse_mode
        try:
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except requests.RequestException as e:
            logger.error(f"Failed to send Telegram message: {e}")
            return False

    def send_alert(self, listing, chat_id):
        if chat_id == 'TERMINAL_PREVIEW':
            logger.info(f"\n--- 🚨 PREVIEW ALERT (Not sent to Telegram) 🚨 ---\nMake: {listing.get('make')}\nModel: {listing.get('model')}\nPrice: {listing.get('price')}\nLink: {listing.get('url')}\n---------------------------------------------------")
            return True
            
        if not self.bot_token or not chat_id:
            logger.warning("Telegram credentials or target chat ID not configured. Skipping alert.")
            return False

        message = f"🚨 *NEW LISTING FOUND* 🚨\n\n"
        message += f"🚜 *{listing.get('make')} {listing.get('model')}*\n"
        
        if listing.get('year'):
            message += f"📅 Year: {listing.get('year')}\n"
        if listing.get('hours'):
            message += f"⏳ Hours: {listing.get('hours')}\n"
        if listing.get('price'):
            message += f"💰 Price: {listing.get('price')}\n"
        if listing.get('location'):
            message += f"📍 Location: {listing.get('location')}\n"
            
        message += f"\n🔗 [Click here to view listing]({listing.get('url')})"

        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'Markdown'
        }

        try:
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            logger.info(f"Telegram alert sent for listing {listing.get('id')}")
            return True
        except requests.RequestException as e:
            logger.error(f"Failed to send Telegram alert: {e}")
            return False
