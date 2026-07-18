"""Machineryline.info harvester — pan-European/global machinery aggregator
(Autoline group). Verified open from the VPS (2026-07-09): no WAF; robots.txt
only blocks internal /api/ and widget paths, not listing pages.

Search pages carry a schema.org JSON-LD ItemList whose Product entries include
price (offers) and a description string with country, year and running hours —
so parsing is JSON-based, no fragile HTML selectors.

The site lists machines WORLDWIDE, so each listing's country (parsed from the
description, e.g. "... sale advertisement from France ➤ ...") is checked
against the business's shipping regions: USA, Canada, Europe, Australia.

No-auctions rule: only /-/sale/ listing URLs are accepted (auction ads live
under /-/auction/).
"""
import json
import logging
import re

from .base_scraper import BaseScraper
from .utils import classify, stable_id

logger = logging.getLogger(__name__)

# Countries the business ships from. European coverage is deliberately wide —
# any European country is fine; the big lists are DE/NL/FR/IT/ES/BE/PL anyway.
ALLOWED_COUNTRIES = {
    "USA", "United States", "Canada", "Australia",
    "Germany", "Netherlands", "France", "Italy", "Spain", "Portugal",
    "Belgium", "Luxembourg", "Austria", "Switzerland", "Poland",
    "Czech Republic", "Czechia", "Slovakia", "Hungary", "Romania", "Bulgaria",
    "Greece", "Croatia", "Slovenia", "Serbia", "Bosnia and Herzegovina",
    "North Macedonia", "Albania", "Denmark", "Sweden", "Norway", "Finland",
    "Estonia", "Latvia", "Lithuania", "Ireland", "United Kingdom", "UK",
    "Great Britain", "Iceland", "Malta", "Cyprus", "Moldova", "Ukraine",
}

_COUNTRY_RE = re.compile(r"advertisement from ([A-Za-z][A-Za-z \-]*?)\s*[➤>]")
_YEAR_RE = re.compile(r"Year of manufacture:\s*(\d{4})")
_HOURS_RE = re.compile(r"Running hours:\s*([\d\s.,]+)\s*h")


class MachinerylineScraper(BaseScraper):
    def __init__(self):
        super().__init__(source_name="Machineryline")

    @staticmethod
    def _parse_description(desc):
        """Pull (country, year, hours) out of the listing description string."""
        country = year = hours = None
        if desc:
            m = _COUNTRY_RE.search(desc)
            if m:
                country = m.group(1).strip()
            m = _YEAR_RE.search(desc)
            if m:
                year = int(m.group(1))
            m = _HOURS_RE.search(desc)
            if m:
                digits = re.sub(r"[^\d]", "", m.group(1))
                hours = int(digits) if digits else None
        return country, year, hours

    def scrape(self, search_urls):
        for base_url in search_urls:
            logger.info(f"Hunting Machineryline: {base_url}")
            soup = self.fetch_page(base_url)
            if not soup:
                logger.warning(f"Failed to fetch {base_url}.")
                continue

            items = []
            for script in soup.find_all("script", type="application/ld+json"):
                try:
                    data = json.loads((script.string or script.get_text()).strip())
                except Exception:
                    continue
                if isinstance(data, dict) and data.get("@type") == "ItemList":
                    items = [e.get("item") or {} for e in data.get("itemListElement", [])]
                    break

            if not items:
                logger.warning(f"No ItemList JSON found on {base_url} (markup change?).")
                continue

            for item in items:
                try:
                    title = (item.get("name") or "").strip()  # e.g. "Caterpillar 966H"

                    match = classify(title)
                    if not match:
                        continue

                    url = (item.get("url") or "").split("?")[0]
                    # Direct-sale ads only — auctions live under /-/auction/.
                    if "/-/sale/" not in url:
                        continue

                    country, year, hours = self._parse_description(item.get("description"))

                    # Enforce the shipping regions; unknown country = skip (honest).
                    if country not in ALLOWED_COUNTRIES:
                        continue

                    offer = item.get("offers") or {}
                    price = None
                    try:
                        price = f"{offer.get('priceCurrency', 'EUR')} {float(offer['price']):,.0f}"
                    except Exception:
                        pass

                    yield {
                        "id": stable_id(url, "ml"),
                        "url": url,
                        "make": match["make"],
                        "model": match["model"],
                        "category": match["category"],
                        "year": year,
                        "hours": hours,
                        "price": price,
                        "location": country,
                        "country": country,
                        "source": self.source_name,
                    }
                except Exception as e:
                    logger.error(f"Error parsing Machineryline item: {e}")
