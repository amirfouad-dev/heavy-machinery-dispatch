from .base_scraper import BaseScraper
import re
import logging
from urllib.parse import urlparse
from .utils import classify, stable_id

logger = logging.getLogger(__name__)

# Craigslist subdomains that are in Canada; everything else defaults to USA.
_CANADA_SUBDOMAINS = {
    "toronto", "vancouver", "montreal", "calgary", "edmonton", "ottawa",
    "winnipeg", "halifax", "victoria", "saskatoon", "regina", "quebec",
    "kitchener", "windsor", "hamilton", "kelowna", "kamloops", "nanaimo",
    "thunderbay", "sudbury", "guelph", "barrie", "peterborough", "abbotsford",
    "fredericton", "moncton", "stjohns", "whitehorse", "yellowknife",
}


def _geo_from_url(url):
    """Derive (city, country) from a Craigslist search URL's subdomain.

    Honest coarse location: we know which city board we searched even when the
    listing card doesn't spell it out. Returns ('Houston', 'USA') style tuples.
    """
    try:
        host = urlparse(url).netloc  # e.g. houston.craigslist.org
        sub = host.split(".")[0].lower()
    except Exception:
        return None, "USA"
    city = sub.replace("-", " ").title()
    country = "Canada" if sub in _CANADA_SUBDOMAINS else "USA"
    return city, country


class CraigslistScraper(BaseScraper):
    def __init__(self):
        super().__init__(source_name="Craigslist")

    def scrape(self, search_urls):
        for base_url in search_urls:
            city, country = _geo_from_url(base_url)
            logger.info(f"Hunting Craigslist ({city}, {country}): {base_url}")
            soup = self.fetch_page(base_url)

            if not soup:
                logger.warning(f"Failed to fetch {base_url}.")
                continue

            listings = soup.find_all('li', class_='cl-static-search-result')
            if not listings:
                logger.warning(f"Could not find listing elements on {base_url}.")
                continue

            for listing in listings:
                try:
                    title_elem = listing.find('div', class_='title')
                    title = title_elem.text.strip() if title_elem else ''

                    # Precise catalog match on the full title.
                    match = classify(title)
                    if not match:
                        continue

                    price_elem = listing.find('div', class_='price')
                    price = price_elem.text.strip() if price_elem else 'Call for Price'

                    link_elem = listing.find('a', href=True)
                    url = link_elem['href'] if link_elem else base_url

                    # Parse a real year from the title if present; never fabricate.
                    ym = re.search(r'\b(19[89]\d|20[0-3]\d)\b', title)
                    year = int(ym.group(1)) if ym else None

                    yield {
                        'id': stable_id(url, 'cl'),
                        'url': url,
                        'make': match['make'],
                        'model': match['model'],
                        'category': match['category'],
                        'year': year,
                        'hours': None,  # not available in search results
                        'price': price,
                        'location': f"{city}, {country}" if city else country,
                        'country': country,
                        'source': self.source_name,
                    }
                except Exception as e:
                    logger.error(f"Error parsing Craigslist listing: {e}")
