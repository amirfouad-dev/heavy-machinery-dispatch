"""Mascus scraper — pan-European (and global) heavy-machinery marketplace.

Reachability (2026-07-08): Mascus geo-blocks Egypt at the CloudFront edge, but is
fully reachable from the Paris VPS with a plain requests GET (no cloudscraper /
proxy needed). So this runs SERVER-SIDE only, as part of the hourly cron.

Parsing strategy: Mascus is a Next.js app. Every page embeds a `__NEXT_DATA__`
JSON blob with fully structured listing data (far more robust than HTML
selectors). We read `props.pageProps.searchRes.searchData.items` for the list,
then the detail page's blob for seller contact + the full image set.

Mirror model: because employees are in Egypt (also geo-blocked), the images and
seller contact are captured server-side so the dashboard can re-serve them. See
`enrich()` — it downloads each listing's photos into MEDIA_ROOT/mascus/<id>/ and
returns the seller fields for the `listing_details` table.
"""
import os
import re
import json
import time
import random
import logging
import requests

from .utils import classify, stable_id

logger = logging.getLogger(__name__)

# Where mirrored images are written. Must match api.py's MEDIA_ROOT so the API
# can serve them at /media/<rel-path>. Defaults to scraper_project/media.
MEDIA_ROOT = os.environ.get(
    "MEDIA_ROOT",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "media"),
)

# Country-code -> display name for the few markets we see most (best-effort;
# unknown codes fall through to the raw code so geocoding still has something).
_COUNTRY_NAMES = {
    "US": "USA", "CA": "Canada", "GB": "United Kingdom", "DE": "Germany",
    "FR": "France", "NL": "Netherlands", "IT": "Italy", "ES": "Spain",
    "BE": "Belgium", "SE": "Sweden", "PL": "Poland", "AT": "Austria",
    "IE": "Ireland", "DK": "Denmark", "FI": "Finland", "NO": "Norway",
    "PT": "Portugal", "CH": "Switzerland", "AU": "Australia", "CZ": "Czechia",
}

# product image URLs on Mascus' CloudFront CDN (the CDN is NOT geo-blocked).
_IMG_RE = re.compile(
    r'https://[a-z0-9]+\.cloudfront\.net/image/product/[^\s"\\]+\.(?:jpg|jpeg|png)',
    re.I,
)
_NEXT_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


class MascusScraper:
    source_name = "Mascus"
    BASE = "https://www.mascus.com"

    # Pages of search results to walk per category URL each run.
    MAX_PAGES = int(os.environ.get("MASCUS_MAX_PAGES", "3"))
    # Cap images mirrored per listing (they're "medium" res, ~10-40 KB each).
    MAX_IMAGES = int(os.environ.get("MASCUS_MAX_IMAGES", "12"))
    # Cap on NEW listings fully processed per run (enrichment is heavy). main.py
    # reads this so the first-run backfill is spread over several cron cycles.
    enrich_cap = int(os.environ.get("MASCUS_ENRICH_CAP", "25"))

    def __init__(self):
        self.source_name = "Mascus"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/126.0.0.0 Safari/537.36"),
            "Accept-Language": "en-US,en;q=0.9",
        })

    # -- low-level fetch -----------------------------------------------------
    def _get(self, url, timeout=30):
        time.sleep(random.uniform(1.0, 2.5))  # be polite
        r = self.session.get(url, timeout=timeout)
        r.raise_for_status()
        return r.text

    def _next_data(self, html):
        m = _NEXT_RE.search(html or "")
        if not m:
            return None
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _norm_model(model):
        """Collapse internal whitespace so a structured suffix isn't lost.

        Mascus gives make/model as separate structured fields, so "950 H" means a
        950H (off-catalog) — NOT a bare 950. Collapsing to "950H" lets classify()
        reject it correctly instead of matching the bare 950 up to the space.
        """
        return re.sub(r"\s+", "", (model or "")).upper()

    @staticmethod
    def _format_price(item):
        # Auction ads never reach here (filtered out in scrape()).
        orig = item.get("priceOriginal")
        unit = item.get("priceOriginalUnit") or ""
        if orig and orig > 0:
            try:
                return f"{unit} {int(orig):,}".strip()
            except (TypeError, ValueError):
                pass
        euro = item.get("priceEURO")
        if euro and euro > 0:
            return f"EUR {int(euro):,}"
        return "Call for Price"

    @staticmethod
    def _location(item):
        city = (item.get("locationCity") or "").strip()
        # Mascus sometimes uses "-" or a country code as a placeholder city.
        code = (item.get("locationCountryCode") or "").strip().upper()
        if city in ("-", "--", "") or city.upper() == code:
            city = ""
        country = _COUNTRY_NAMES.get(code, code)
        parts = [p for p in (city, country) if p]
        return (", ".join(parts) if parts else "Unknown"), (country or "Unknown")

    # -- search list ---------------------------------------------------------
    def scrape(self, search_urls):
        for base_url in search_urls:
            for page in range(1, self.MAX_PAGES + 1):
                sep = "&" if "?" in base_url else "?"
                url = base_url if page == 1 else f"{base_url}{sep}page={page}"
                logger.info(f"Mascus: fetching {url}")
                try:
                    html = self._get(url)
                except Exception as e:
                    logger.warning(f"Mascus fetch failed for {url}: {e}")
                    break

                data = self._next_data(html)
                try:
                    items = data["props"]["pageProps"]["searchRes"]["searchData"]["items"]
                except (TypeError, KeyError):
                    logger.warning(f"Mascus: no items array on {url}")
                    break
                if not items:
                    break  # ran past the last page

                for it in items:
                    # User directive (2026-07-08): NO auction listings — only
                    # direct-sale machines. auctionAd = Mascus auction lots;
                    # mpeAd = Ritchie Bros / IronPlanet Marketplace-E feeds.
                    if it.get("auctionAd") or it.get("mpeAd"):
                        continue
                    brand = it.get("brand", "") or ""
                    model = it.get("model", "") or ""
                    match = classify(f"{brand} {self._norm_model(model)}")
                    if not match:
                        continue

                    asset = it.get("assetUrl") or ""
                    if not asset:
                        continue
                    item_url = asset if asset.startswith("http") else self.BASE + asset

                    location, country = self._location(it)

                    hours = None
                    if (it.get("meterReadoutUnit") or "").lower() in ("h", "hr", "hrs", "hours"):
                        try:
                            hours = int(it.get("meterReadout"))
                        except (TypeError, ValueError):
                            hours = None

                    yield {
                        "id": stable_id(item_url, "msc"),
                        "url": item_url,
                        "make": match["make"],
                        "model": match["model"],
                        "category": match["category"],
                        "year": it.get("yearOfManufacture") or None,
                        "hours": hours,
                        "price": self._format_price(it),
                        "location": location,
                        "country": country,
                        "currency": it.get("priceOriginalUnit"),
                        "source": self.source_name,
                        # carried for enrich()/fallbacks; ignored by the DB insert.
                        "_thumb": it.get("imageUrl"),
                        "_seller_phone": it.get("sellerPhone"),
                        "_company": it.get("companyName"),
                    }

    # -- detail enrichment + image mirroring ---------------------------------
    def enrich(self, listing):
        """Fetch the detail page for a NEW listing: pull seller contact + all
        images, download the images locally, and return a `listing_details` dict.

        Called by main.py only after is_new_listing() passes, and capped per run.
        Never raises — on any failure it returns whatever it managed (at least the
        list thumbnail), so a listing is never dropped just because enrichment
        hiccuped.
        """
        detail = {
            "seller_name": None, "seller_phone": listing.get("_seller_phone"),
            "seller_email": None, "seller_company": listing.get("_company"),
            "seller_website": None, "seller_address": None,
            "images": [], "description": None,
        }
        img_urls = []
        try:
            dd = self._next_data(self._get(listing["url"]))
        except Exception as e:
            logger.warning(f"Mascus enrich fetch failed for {listing['url']}: {e}")
            dd = None

        if dd:
            f = self._find_fields(dd, {
                "sellerFirstName", "sellerLastName", "sellerEmail", "sellerPhone",
                "companyName", "companyWebSite", "companyStreet", "companyCity",
                "companyRegion", "companyPostalCode", "companyCountry",
            })
            name = " ".join(x for x in (f.get("sellerFirstName"), f.get("sellerLastName")) if x).strip()
            detail["seller_name"] = name or f.get("companyName") or detail["seller_company"]
            detail["seller_phone"] = f.get("sellerPhone") or detail["seller_phone"]
            detail["seller_email"] = f.get("sellerEmail")
            detail["seller_company"] = f.get("companyName") or detail["seller_company"]
            detail["seller_website"] = f.get("companyWebSite")
            addr = ", ".join(x for x in (
                f.get("companyStreet"), f.get("companyCity"), f.get("companyRegion"),
                f.get("companyPostalCode"), f.get("companyCountry"),
            ) if x)
            detail["seller_address"] = addr or None
            img_urls = sorted(set(_IMG_RE.findall(json.dumps(dd))))

        if not img_urls and listing.get("_thumb"):
            img_urls = [listing["_thumb"]]

        detail["images"] = self._download_images(listing["id"], img_urls)
        return detail

    @staticmethod
    def _find_fields(obj, wanted):
        """First occurrence of each key in `wanted` anywhere in the nested JSON."""
        found = {}
        stack = [obj]
        while stack and len(found) < len(wanted):
            cur = stack.pop()
            if isinstance(cur, dict):
                for k, v in cur.items():
                    if k in wanted and k not in found and isinstance(v, (str, int, float)):
                        s = str(v).strip()
                        if s:
                            found[k] = s
                    elif isinstance(v, (dict, list)):
                        stack.append(v)
            elif isinstance(cur, list):
                stack.extend(cur)
        return found

    def _download_images(self, listing_id, urls):
        """Download up to MAX_IMAGES into MEDIA_ROOT/mascus/<id>/ and return the
        list of web-relative paths (e.g. 'mascus/<id>/1.jpg') for the DB."""
        rels = []
        if not urls:
            return rels
        dest_dir = os.path.join(MEDIA_ROOT, "mascus", listing_id)
        os.makedirs(dest_dir, exist_ok=True)
        for i, u in enumerate(urls[: self.MAX_IMAGES], start=1):
            ext = os.path.splitext(u.split("?")[0])[1].lower() or ".jpg"
            if ext not in (".jpg", ".jpeg", ".png"):
                ext = ".jpg"
            fname = f"{i}{ext}"
            # Prefer the full-size "large" variant (~130 KB) over the "medium"
            # thumbnail (~7 KB) so staff can actually assess the machine; fall
            # back to the original URL if the large variant isn't available.
            candidates = []
            if "/medium/" in u:
                candidates.append(u.replace("/medium/", "/large/"))
            candidates.append(u)
            for cand in candidates:
                try:
                    r = self.session.get(cand, timeout=20)
                    r.raise_for_status()
                    with open(os.path.join(dest_dir, fname), "wb") as fh:
                        fh.write(r.content)
                    rels.append(f"mascus/{listing_id}/{fname}")
                    break
                except Exception as e:
                    logger.warning(f"Mascus image download failed ({cand}): {e}")
        return rels
