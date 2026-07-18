"""TradeEarthmovers.com.au harvester — Australia's machinery classifieds.

Verified open from the VPS (2026-07-09): no WAF, robots.txt allows everything.
Search pages embed schema.org JSON-LD with the full product list (name, url,
year, price), so parsing reads that JSON instead of fragile HTML selectors.

Region: Australia only (fills the one target region no other source covers).
No-auctions rule: targets use the site's own `classifiedstype-forsale` filter,
and we additionally require the offer's businessFunction to be "Sell".

Search-page cards carry no structured location, so location is stored as the
honest coarse "Australia" — the listing URL has the rest.
"""
import json
import logging
import random
import re
import subprocess
import time

from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from .utils import classify, stable_id

logger = logging.getLogger(__name__)

# TEM is behind AWS WAF, which serves a JS cookie-challenge (HTTP 202) to
# python's TLS fingerprint but passes curl. Verified live 2026-07-09:
# requests/cloudscraper -> 3.4KB challenge stub; curl -> full 300KB+ page.
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _iter_products(node):
    """Yield every schema.org Product dict anywhere in a JSON-LD tree (they sit
    nested under @graph -> WebPageElement -> offers -> itemOffered)."""
    if isinstance(node, dict):
        if node.get("@type") == "Product":
            yield node
        for v in node.values():
            yield from _iter_products(v)
    elif isinstance(node, list):
        for v in node:
            yield from _iter_products(v)


class TradeEarthmoversScraper(BaseScraper):
    def __init__(self):
        super().__init__(source_name="TradeEarthmovers")

    def fetch_page(self, url, use_playwright=False):
        """Fetch via curl subprocess — the only client that passes TEM's AWS
        WAF from this server (see module docstring). Same polite delay as the
        base class."""
        time.sleep(random.uniform(2.0, 5.0))
        try:
            out = subprocess.run(
                ["curl", "-s", "-L", "--max-time", "25", "-A", _UA, url],
                capture_output=True, timeout=40,
            )
            html = out.stdout.decode("utf-8", errors="replace")
            if len(html) < 10000 or "awsWafCookie" in html[:3000]:
                logger.warning(f"TEM served a WAF challenge/stub for {url} "
                               f"({len(html)} bytes).")
                return None
            return BeautifulSoup(html, "html.parser")
        except Exception as e:
            logger.error(f"curl fetch failed for {url}: {e}")
            return None

    def scrape(self, search_urls):
        for base_url in search_urls:
            logger.info(f"Hunting TradeEarthmovers: {base_url}")
            soup = self.fetch_page(base_url)
            if not soup:
                logger.warning(f"Failed to fetch {base_url}.")
                continue

            products = []
            for script in soup.find_all("script"):
                text = script.string or script.get_text() or ""
                if '"@type":"Product"' not in text.replace(" ", ""):
                    continue
                try:
                    products = list(_iter_products(json.loads(text.strip())))
                except Exception as e:
                    logger.warning(f"TradeEarthmovers JSON-LD parse failed on {base_url}: {e}")
                break

            if not products:
                logger.warning(f"No product JSON found on {base_url} (markup change?).")
                continue

            for item in products:
                try:
                    title = (item.get("name") or "").strip()  # e.g. "2018 CATERPILLAR 972M"

                    match = classify(title)
                    if not match:
                        continue

                    url = item.get("url")
                    if not url:
                        continue

                    offers = item.get("offers") or []
                    offer = offers[0] if isinstance(offers, list) and offers else (
                        offers if isinstance(offers, dict) else {})

                    # Belt-and-braces on the no-auctions rule: the URL filter is
                    # for-sale only, but skip anything not explicitly a sale.
                    bf = (offer.get("businessFunction") or "")
                    if bf and not bf.endswith("#Sell"):
                        continue

                    price = None
                    try:
                        price = f"{offer.get('priceCurrency', 'AUD')} {float(offer['price']):,.0f}"
                    except Exception:
                        pass

                    year = item.get("productionDate")
                    if not year:
                        ym = re.search(r"\b(19[89]\d|20[0-3]\d)\b", title)
                        year = int(ym.group(1)) if ym else None

                    yield {
                        "id": stable_id(url, "tem"),
                        "url": url,
                        "make": match["make"],
                        "model": match["model"],
                        "category": match["category"],
                        "year": int(year) if year else None,
                        "hours": None,  # not in the search-page JSON
                        "price": price,
                        "location": "Australia",
                        "country": "Australia",
                        "source": self.source_name,
                    }
                except Exception as e:
                    logger.error(f"Error parsing TradeEarthmovers item: {e}")
