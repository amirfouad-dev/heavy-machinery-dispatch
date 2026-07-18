import os
import time
import requests
from dotenv import load_dotenv

def get_chat_id(bot_token):
    print("\n--- Employee Telegram Setup ---")
    print("1. Ask your employee to search for your Bot on Telegram and click 'Start'.")
    print("2. Ask them to send any message to the bot right now (e.g., 'hello').")
    print("Waiting for an employee to send a message... (Will check every 5 seconds for 5 minutes)")
    
    url = f"https://api.telegram.org/bot{bot_token}/getUpdates"
    
    for _ in range(60):
        time.sleep(5)
        try:
            response = requests.get(url, timeout=10)
            data = response.json()
            
            if data.get('ok') and data.get('result'):
                # Get the most recent message
                updates = data['result']
                for update in reversed(updates):
                    if 'message' in update:
                        chat = update['message']['chat']
                        # Allow both private direct messages and group messages
                        if chat.get('type') in ['private', 'group', 'supergroup']:
                            chat_id = str(chat['id'])
                            
                            # Determine name
                            if chat.get('type') == 'private':
                                name = chat.get('first_name', 'Employee')
                            else:
                                name = chat.get('title', 'Group')
                                
                            print(f"\n[Success] Found: '{name}' (ID: {chat_id})")
                            return chat_id
                print("Found updates, but no messages yet.")
            else:
                print(".", end="", flush=True)
        except Exception as e:
            print(f"\nError connecting to Telegram: {e}")
            return None
            
    print("\n[Error] Timed out. Could not find any group messages.")
    return None

def update_env_file(chat_id):
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    
    # Read existing or create new
    lines = []
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            lines = f.readlines()
            
    # Update or add TELEGRAM_CHAT_IDS
    updated = False
    for i, line in enumerate(lines):
        if line.startswith('TELEGRAM_CHAT_IDS='):
            existing_ids = line.strip().split('=')[1]
            if existing_ids == 'your_chat_id_1,your_chat_id_2' or not existing_ids:
                lines[i] = f'TELEGRAM_CHAT_IDS={chat_id}\n'
            elif chat_id not in existing_ids.split(','):
                lines[i] = f'{line.strip()},{chat_id}\n'
            else:
                print("[Warning] This ID is already in your .env file!")
            updated = True
            break
            
    if not updated:
        lines.append(f'\nTELEGRAM_CHAT_IDS={chat_id}\n')
        
    with open(env_path, 'w') as f:
        f.writelines(lines)
    print("[Success] .env file successfully updated with the Employee's Chat ID!")

if __name__ == '__main__':
    load_dotenv(override=True)
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    
    if not token or token == 'your_bot_token_here':
        print("[Error] You need to put your TELEGRAM_BOT_TOKEN in the .env file first!")
        print("Please create the bot via BotFather, copy the token, put it in .env, and run this again.")
    else:
        chat_id = get_chat_id(token)
        if chat_id:
            update_env_file(chat_id)
            print("\n[Complete] Setup Complete! You can now run main.py --run to test the scraper.")
