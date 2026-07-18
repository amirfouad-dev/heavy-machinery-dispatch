from .base_scraper import BaseScraper
import logging
from .utils import classify, stable_id

logger = logging.getLogger(__name__)


class MachineryTraderScraper(BaseScraper):
    """MachineryTrader (Sandhills). Cloudflare/WAF-protected — returns 403 to
    datacenter IPs, so it is NOT part of the active free-sources run. Reach it via
    local_harvester.py from a residential IP, or enable PROXY_URL later.

    The CSS selectors below are unverified against live markup (the site blocks us),
    so treat this parser as a scaffold: confirm selectors against a real fetched
    page before relying on it.
    """

    def __init__(self):
        super().__init__(source_name="MachineryTrader")

    def scrape(self, search_urls):
        for base_url in search_urls:
            for page in range(1, 4):
                separator = '&' if '?' in base_url else '?'
                url = f"{base_url}{separator}page={page}"

                logger.info(f"Hunting MachineryTrader: {url}")
                soup = self.fetch_page(url)
                if not soup:
                    logger.warning(f"Failed to fetch {url} (likely WAF-blocked).")
                    continue

                listings = soup.find_all('div', class_='listing-card')
                if not listings:
                    logger.warning(f"Could not find listing elements on {url}.")
                    continue

                for listing in listings:
                    try:
                        title_elem = listing.find('h3', class_='title')
                        title = title_elem.text.strip() if title_elem else ''

                        match = classify(title)
                        if not match:
                            continue

                        price_elem = listing.find('span', class_='price')
                        price = price_elem.text.strip() if price_elem else 'Call for Price'

                        loc_elem = listing.find('div', class_='location')
                        raw_loc = loc_elem.text.strip() if loc_elem else 'Unknown'

                        link_elem = listing.find('a', href=True)
                        item_url = link_elem['href'] if link_elem else url
                        if item_url.startswith('/'):
                            item_url = "https://www.machinerytrader.com" + item_url

                        yield {
                            'id': stable_id(item_url, 'mt'),
                            'url': item_url,
                            'make': match['make'],
                            'model': match['model'],
                            'category': match['category'],
                            'year': None,
                            'hours': None,
                            'price': price,
                            'location': self.clean_location_string(raw_loc),
                            'source': self.source_name,
                        }
                    except Exception as e:
                        logger.error(f"Error parsing MT listing: {e}")
