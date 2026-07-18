import requests
from bs4 import BeautifulSoup
import logging
import random
import time
import os

try:
    import cloudscraper
except ImportError:
    cloudscraper = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class BaseScraper:
    def __init__(self, source_name="Unknown"):
        self.source_name = source_name
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/114.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
        ]

    def _get_random_headers(self):
        return {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }

    def fetch_page(self, url, use_playwright=False):
        if use_playwright:
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True)
                    page = browser.new_page()
                    page.goto(url, timeout=30000)
                    html = page.content()
                    browser.close()
                    return BeautifulSoup(html, 'html.parser')
            except ImportError:
                logger.error("Playwright is not installed.")
                return None
            except Exception as e:
                logger.error(f"Playwright error fetching {url}: {e}")
                return None
        else:
            try:
                delay = random.uniform(2.0, 5.0)
                logger.info(f"Sleeping for {delay:.2f}s before fetching {url}...")
                time.sleep(delay)
                
                proxy_url = os.environ.get('PROXY_URL')
                proxies = {'http': proxy_url, 'https': proxy_url} if proxy_url else None
                
                if cloudscraper:
                    scraper = cloudscraper.create_scraper()
                    response = scraper.get(url, headers=self._get_random_headers(), proxies=proxies, timeout=15)
                else:
                    response = requests.get(url, headers=self._get_random_headers(), proxies=proxies, timeout=15)
                    
                response.raise_for_status()
                return BeautifulSoup(response.content, 'html.parser')
            except Exception as e:
                logger.error(f"Error fetching {url}: {e}")
                return None

    def parse_listing(self, element):
        raise NotImplementedError

    def scrape(self, search_urls):
        raise NotImplementedError

    @staticmethod
    def clean_location_string(location):
        if not location:
            return "Unknown"
        parts = [p.strip() for p in location.split(',')]
        if len(parts) >= 2:
            cleaned = f"{parts[-2]}, {parts[-1]}"
            import re
            cleaned = re.sub(r'\s+\d{5}(-\d{4})?\s*$', '', cleaned)
            return cleaned
        return location.strip()
