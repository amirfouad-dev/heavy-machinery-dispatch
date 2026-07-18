from .base_scraper import BaseScraper
import logging
from .utils import classify, stable_id

logger = logging.getLogger(__name__)


class IronPlanetScraper(BaseScraper):
    """IronPlanet / RB Auction. This site is behind a WAF (Cloudflare/Akamai) and
    typically returns 403 to datacenter IPs. It is NOT wired into the active run
    while we're on free sources only — see harvesting-strategy. Kept here so it's
    ready if residential proxies are enabled later.

    NOTE: the previous version injected fabricated "dummy" listings when the fetch
    failed, which poisoned the database. That fallback has been removed — a failed
    fetch now yields nothing, which is the correct behavior.
    """

    def __init__(self):
        super().__init__(source_name="IronPlanet")

    def scrape(self, search_urls):
        for base_url in search_urls:
            for page in range(1, 4):
                separator = '&' if '?' in base_url else '?'
                url = f"{base_url}{separator}page={page}"

                logger.info(f"Hunting IronPlanet: {url}")
                soup = self.fetch_page(url)
                if not soup:
                    logger.warning(f"Failed to fetch {url} (likely WAF-blocked).")
                    continue

                listings = soup.find_all('div', class_='search-result-item')
                if not listings:
                    logger.warning(f"Could not find listing elements on {url}.")
                    continue

                for listing in listings:
                    try:
                        title_elem = listing.find('h3', class_='item-title')
                        title = title_elem.text.strip() if title_elem else ''

                        match = classify(title)
                        if not match:
                            continue

                        price_elem = listing.find('span', class_='item-price')
                        price = price_elem.text.strip() if price_elem else 'Auction'

                        loc_elem = listing.find('div', class_='item-location')
                        raw_loc = loc_elem.text.strip() if loc_elem else 'Unknown'

                        link_elem = listing.find('a', href=True)
                        item_url = link_elem['href'] if link_elem else url

                        yield {
                            'id': stable_id(item_url, 'ip'),
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
                        logger.error(f"Error parsing IronPlanet listing: {e}")
