import os
import time
import logging
import requests
from dotenv import load_dotenv
from scrapers.machinerytrader_scraper import MachineryTraderScraper
from scrapers.url_validator import is_valid_link
from scrapers.utils import is_allowed_model

load_dotenv(override=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Server endpoint is read from the environment so the IP is not hardcoded in source.
# Set SERVER_URL in .env (e.g. SERVER_URL=http://your-server-ip:8000)
API_ENDPOINT = os.environ.get('SERVER_URL', 'http://localhost:8000').rstrip('/') + '/api/listings/push'

# Sent as X-API-Key so the server accepts the push when API_KEY auth is enabled.
API_KEY = os.environ.get('API_KEY')


def _push_headers():
    headers = {}
    if API_KEY:
        headers['X-API-Key'] = API_KEY
    return headers

def run_local_harvester():
    logger.info("Starting local harvester for MachineryTrader...")
    
    scraper = MachineryTraderScraper()
    urls = [
        "https://www.machinerytrader.com/listings/search?Category=1054&Country=USA",  # Excavators USA
        "https://www.machinerytrader.com/listings/search?Category=1054&Country=CAN",  # Excavators CAN
        "https://www.machinerytrader.com/listings/search?Category=1056&Country=USA",  # Wheel Loaders USA
        "https://www.machinerytrader.com/listings/search?Category=1050&Country=USA",  # Dump Trucks USA
    ]
    
    for url in urls:
        logger.info(f"Harvesting URL: {url}")
        for listing in scraper.scrape([url]):
            # Filter check
            if not is_allowed_model(listing.get('make', ''), listing.get('model', '')):
                continue

            # Validate URL
            if not is_valid_link(listing['url']):
                logger.warning(f"URL failed validation, skipping: {listing['url']}")
                continue
                
            logger.info(f"Found valid listing: {listing.get('make')} {listing.get('model')}. Pushing to server...")
            
            # Push to server
            try:
                response = requests.post(API_ENDPOINT, json=listing, headers=_push_headers(), timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    logger.info(f"Server response: {data.get('message')}")
                else:
                    logger.error(f"Failed to push. Server returned HTTP {response.status_code}: {response.text}")
            except Exception as e:
                logger.error(f"Failed to connect to server: {e}")
                
if __name__ == "__main__":
    while True:
        run_local_harvester()
        logger.info("Harvester cycle complete. Sleeping for 2 hours before next run...")
        time.sleep(7200) # Sleep for 2 hours to avoid bans
