"""eBay harvester — official Browse API (free tier), no scraping/WAF fights.

Auth: OAuth2 client-credentials using EBAY_CLIENT_ID / EBAY_CLIENT_SECRET from
.env (production keyset from https://developer.ebay.com). If the keys are not
set, main.py skips this source entirely.

Regions are enforced two ways: we query region-specific marketplaces AND filter
by itemLocationCountry, so only machines physically in USA / Canada / Europe /
Australia come through — matching the business's shipping lanes.

eBay is full of parts, manuals and diecast toys that mention real model numbers
("CAT 950G service manual" would pass the catalog classifier because the title
contains 'loader'). Two extra guards handle that: a minimum-price filter in the
API call, and a junk-word screen on the title.
"""
import base64
import logging
import os
import re
import time

import requests

from .base_scraper import BaseScraper
from .utils import classify, stable_id

logger = logging.getLogger(__name__)

_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"

# Below this price (in each marketplace's local currency) listings are almost
# always parts/manuals/toys, not whole machines. USD/CAD/GBP/EUR/AUD are close
# enough in magnitude that one number works for all.
_MIN_PRICE = 5000

# Title words that mean "not a whole machine" even when a machine word is
# present ("CAT 950G loader service manual", "1/50 scale wheel loader toy").
_JUNK_WORDS = (
    "manual", "brochure", "book", "catalog", "decal", "sticker", "keychain",
    "toy", "diecast", "die-cast", "die cast", "norscot", "scale model",
    "1/50", "1:50", "1/64", "1:64", "1/87", "1:87",
    "part only", "parts only", "for parts", "seat", "window", "glass", "door",
    "pump", "valve", "hose", "belt", "radiator", "starter", "alternator",
    "injector", "turbocharger", "turbo", "cylinder", "gasket", "bearing",
    "filter", "tire", "tires", "tyre", "rim", "wheel only", "track link",
    "final drive", "sprocket", "undercarriage", "cutting edge", "tooth", "teeth",
)

# ISO country code (used by the API) -> display name stored in the DB.
_COUNTRY_NAMES = {
    "US": "USA", "CA": "Canada", "AU": "Australia",
    "GB": "UK", "DE": "Germany", "FR": "France", "IT": "Italy",
    "ES": "Spain", "NL": "Netherlands", "BE": "Belgium", "IE": "Ireland",
    "AT": "Austria", "PL": "Poland",
}


class EbayScraper(BaseScraper):
    def __init__(self):
        super().__init__(source_name="eBay")
        self._token = None

    # -- auth -----------------------------------------------------------------
    def _get_token(self):
        """Mint an application access token (client-credentials grant)."""
        if self._token:
            return self._token
        client_id = os.environ.get("EBAY_CLIENT_ID")
        client_secret = os.environ.get("EBAY_CLIENT_SECRET")
        if not client_id or not client_secret:
            logger.warning("eBay credentials not set (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET).")
            return None
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        try:
            resp = requests.post(
                _TOKEN_URL,
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={
                    "grant_type": "client_credentials",
                    "scope": "https://api.ebay.com/oauth/api_scope",
                },
                timeout=20,
            )
            resp.raise_for_status()
            self._token = resp.json()["access_token"]
            return self._token
        except Exception as e:
            logger.error(f"eBay OAuth token request failed: {e}")
            return None

    # -- search ---------------------------------------------------------------
    def _search(self, token, marketplace, country, query):
        """One Browse API search; returns the raw itemSummaries list."""
        try:
            resp = requests.get(
                _SEARCH_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-EBAY-C-MARKETPLACE-ID": marketplace,
                },
                params={
                    "q": query,
                    "limit": "100",
                    "filter": f"itemLocationCountry:{country},price:[{_MIN_PRICE}..]",
                },
                timeout=25,
            )
            resp.raise_for_status()
            return resp.json().get("itemSummaries", []) or []
        except Exception as e:
            logger.error(f"eBay search failed ({marketplace} '{query}'): {e}")
            return []

    @staticmethod
    def _is_junk(title):
        low = title.lower()
        return any(w in low for w in _JUNK_WORDS)

    @staticmethod
    def _format_price(price_obj):
        """'USD 28,500' style, matching how Mascus prices are stored."""
        try:
            value = float(price_obj["value"])
            return f"{price_obj['currency']} {value:,.0f}"
        except Exception:
            return None

    @staticmethod
    def _location(item, country_code):
        loc = item.get("itemLocation") or {}
        country = _COUNTRY_NAMES.get(country_code, country_code)
        parts = [loc.get("city"), loc.get("stateOrProvince"), country]
        return ", ".join(p for p in parts if p)

    def scrape(self, targets):
        """`targets` is a list of (marketplace_id, country_code, query) tuples
        from targets.build_ebay_targets()."""
        token = self._get_token()
        if not token:
            return

        for marketplace, country, query in targets:
            logger.info(f"Hunting eBay {marketplace} ({country}): '{query}'")
            items = self._search(token, marketplace, country, query)
            time.sleep(0.5)  # be polite to the API

            for item in items:
                try:
                    title = (item.get("title") or "").strip()

                    match = classify(title)
                    if not match or self._is_junk(title):
                        continue

                    url = item.get("itemWebUrl")
                    if not url:
                        continue

                    # Real year from the title only; never fabricate.
                    ym = re.search(r"\b(19[89]\d|20[0-3]\d)\b", title)

                    yield {
                        # itemId is eBay's stable identifier — survives URL
                        # tracking-parameter churn better than the web URL.
                        "id": stable_id(item.get("itemId") or url, "eb"),
                        "url": url,
                        "make": match["make"],
                        "model": match["model"],
                        "category": match["category"],
                        "year": int(ym.group(1)) if ym else None,
                        "hours": None,  # not exposed in search results
                        "price": self._format_price(item.get("price")),
                        "location": self._location(item, country),
                        "country": _COUNTRY_NAMES.get(country, country),
                        "source": self.source_name,
                    }
                except Exception as e:
                    logger.error(f"Error parsing eBay item: {e}")
