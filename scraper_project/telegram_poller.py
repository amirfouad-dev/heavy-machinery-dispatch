import os
import time
import requests
import sqlite3
import logging
from dotenv import load_dotenv

load_dotenv(override=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), 'db', 'machinery.db')
BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')

def get_updates(offset=None):
    if not BOT_TOKEN:
        return []
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    params = {'timeout': 30, 'offset': offset}
    try:
        response = requests.get(url, params=params, timeout=40)
        response.raise_for_status()
        data = response.json()
        return data.get('result', [])
    except Exception as e:
        logger.error(f"Error fetching updates: {e}")
        return []

def send_message(chat_id, text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {'chat_id': chat_id, 'text': text}
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        logger.error(f"Error sending message: {e}")

def register_user(chat_id, first_name):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check if user already exists by chat_id
    cursor.execute("SELECT id, name FROM users WHERE telegram_chat_id = ?", (str(chat_id),))
    existing = cursor.fetchone()
    
    if existing:
        conn.close()
        return f"Welcome back, {existing[1]}! You are already registered."
        
    # Check if user exists by name but without chat ID
    cursor.execute("SELECT id FROM users WHERE name = ?", (first_name,))
    existing_name = cursor.fetchone()
    
    if existing_name:
        cursor.execute("UPDATE users SET telegram_chat_id = ? WHERE id = ?", (str(chat_id), existing_name[0]))
        conn.commit()
        conn.close()
        return f"Account linked successfully, {first_name}! You will now receive machinery dispatch alerts."
    
    # Create new user
    try:
        cursor.execute("INSERT INTO users (name, role, telegram_chat_id) VALUES (?, 'Operator', ?)", (first_name, str(chat_id)))
        conn.commit()
        conn.close()
        return f"Registration complete, {first_name}! You have been added to the Dispatch Portal and will start receiving machinery alerts."
    except Exception as e:
        conn.close()
        logger.error(f"DB Error: {e}")
        return "An error occurred while registering your account."

def poll():
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN is missing. Poller cannot start.")
        return
        
    logger.info("Telegram Poller started. Listening for /start messages...")
    offset = None
    
    while True:
        updates = get_updates(offset)
        for update in updates:
            offset = update['update_id'] + 1
            
            if 'message' in update:
                message = update['message']
                text = message.get('text', '')
                chat_id = message.get('chat', {}).get('id')
                first_name = message.get('from', {}).get('first_name', 'Operator')
                
                if text.startswith('/start'):
                    logger.info(f"Received /start from {first_name} ({chat_id})")
                    reply = register_user(chat_id, first_name)
                    send_message(chat_id, reply)
                    
        time.sleep(2)

if __name__ == '__main__':
    poll()
