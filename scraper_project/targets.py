"""Harvest targets, organized by source and region.

This replaces the hardcoded wall of URLs that used to live in main.py. To widen
coverage you edit data here, not code. The model filter (scrapers/utils.classify)
does the precise matching, so search queries are deliberately BROAD — cast a wide
net, then filter. See harvesting-strategy memory for source reachability.

Only ACTIVE sources are harvested on the free path (no proxies). Blocked sources
(Mascus/EU, IronPlanet, MachineryTrader, Australia) are scaffolded but disabled;
flip `enabled` to True once residential proxies or the local harvester are wired.
"""

# --- Craigslist (ACTIVE — USA + Canada, reachable unauthenticated) ----------

# Broad queries; the classifier narrows to the exact catalog. 'hva' is
# Craigslist's heavy-equipment category, so results are already on-topic.
CRAIGSLIST_QUERIES = [
    "caterpillar",
    "cat wheel loader",
    "cat loader",
    "cat excavator",
    "cat dump truck",
    "doosan excavator",
]

# City subdomains grouped by country. The scraper derives the real city/country
# from each URL's subdomain, so this grouping is also what tags listing geography.
CRAIGSLIST_CITIES = {
    "USA": [
        "houston", "dallas", "austin", "sanantonio", "elpaso",
        "miami", "orlando", "tampa", "jacksonville",
        "losangeles", "sfbay", "sacramento", "sandiego", "fresno",
        "newyork", "chicago", "atlanta", "denver", "seattle",
        "phoenix", "lasvegas", "neworleans", "kansascity", "charlotte",
        "nashville", "stlouis", "minneapolis", "portland", "boston", "detroit",
    ],
    "Canada": [
        "toronto", "vancouver", "montreal", "calgary",
        "edmonton", "ottawa", "winnipeg", "halifax",
    ],
}


def build_craigslist_urls():
    """Flatten cities x queries into Craigslist heavy-equipment search URLs."""
    urls = []
    for cities in CRAIGSLIST_CITIES.values():
        for city in cities:
            for q in CRAIGSLIST_QUERIES:
                urls.append(
                    f"https://{city}.craigslist.org/search/hva?query={q.replace(' ', '+')}"
                )
    return urls


# --- Mascus (ACTIVE server-side — reachable from the Paris VPS, geo-blocks Egypt)
# Brand-specific category pages (verified 2026-07-08). The classifier narrows to
# the exact Egypt catalog, so we only list the categories the catalog covers:
# CAT wheel loaders, CAT + Doosan crawler excavators, CAT dumpers (769).
MASCUS_CATEGORY_URLS = [
    "https://www.mascus.com/construction/wheel-loaders/cat",
    "https://www.mascus.com/construction/crawler-excavators/cat",
    "https://www.mascus.com/construction/crawler-excavators/doosan",
    "https://www.mascus.com/construction/dumpers/cat",
]


def build_mascus_urls():
    """Category pages Mascus is harvested from (server-side, VPS only)."""
    return list(MASCUS_CATEGORY_URLS)


# --- TradeEarthmovers (ACTIVE — Australia, verified open 2026-07-09) --------
# The site's own classifiedstype-forsale filter enforces the no-auctions rule.
# Two pages per type: page 1 catches new arrivals on the 2-hourly poll; page 2
# is cheap backfill insurance. Dump trucks (CAT 769) go via keyword search —
# the site has no dedicated dump-truck type facet.

TRADEEARTHMOVERS_URLS = [
    "https://www.tradeearthmovers.com.au/search/classifiedstype-forsale/type-loaders/subtype-wheel",
    "https://www.tradeearthmovers.com.au/search/classifiedstype-forsale/type-loaders/subtype-wheel/page-2",
    "https://www.tradeearthmovers.com.au/search/classifiedstype-forsale/type-excavators",
    "https://www.tradeearthmovers.com.au/search/classifiedstype-forsale/type-excavators/page-2",
    "https://www.tradeearthmovers.com.au/search/classifiedstype-forsale/keywords-caterpillar+769",
]


def build_tradeearthmovers_urls():
    return list(TRADEEARTHMOVERS_URLS)


# --- Machineryline (ACTIVE — Europe/global aggregator, verified open 2026-07-09)
# Brand-filtered category pages (real URLs harvested from the live site, not
# guessed). The scraper additionally filters each listing's country to the
# shipping regions and skips /-/auction/ ads. Page 2 = backfill insurance.

MACHINERYLINE_URLS = [
    # Brand pages page 1 — catch newly posted machines of any model.
    "https://machineryline.info/-/construction-loaders/Caterpillar--c179tm2512",
    "https://machineryline.info/-/excavators/Caterpillar--c163tm2512",
    "https://machineryline.info/-/excavators/Doosan--c163tm3881",
    "https://machineryline.info/-/excavators/Doosan--c163tm3881?page=2",
    # Exact-model pages for the Egypt catalog (harvested from the live site
    # 2026-07-09 — the m-codes are ML-internal, do NOT guess new ones). These
    # surface old-model stock that never reaches page 1 of the brand listing.
    # No pages existed for 916/936/970F/972G that day; brand page 1 covers them
    # if inventory ever appears.
    "https://machineryline.info/-/construction-loaders/Caterpillar/910--c179tm2512m29014",
    "https://machineryline.info/-/construction-loaders/Caterpillar/920--c179tm2512m28984",
    "https://machineryline.info/-/construction-loaders/Caterpillar/926--c179tm2512m29101",
    "https://machineryline.info/-/construction-loaders/Caterpillar/930--c179tm2512m28972",
    "https://machineryline.info/-/construction-loaders/Caterpillar/950--c179tm2512m1406",
    "https://machineryline.info/-/construction-loaders/Caterpillar/950E--c179tm2512m6483",
    "https://machineryline.info/-/construction-loaders/Caterpillar/966--c179tm2512m930",
    "https://machineryline.info/-/construction-loaders/Caterpillar/966D--c179tm2512m6122",
    "https://machineryline.info/-/construction-loaders/Caterpillar/966F--c179tm2512m6125",
    "https://machineryline.info/-/construction-loaders/Caterpillar/966G--c179tm2512m6124",
    "https://machineryline.info/-/construction-loaders/Caterpillar/966H--c179tm2512m6121",
    "https://machineryline.info/-/construction-loaders/Caterpillar/972--c179tm2512m1413",
    "https://machineryline.info/-/construction-loaders/Caterpillar/972H--c179tm2512m6549",
    "https://machineryline.info/-/construction-loaders/Caterpillar/980--c179tm2512m931",
    "https://machineryline.info/-/construction-loaders/Caterpillar/980G--c179tm2512m6508",
    "https://machineryline.info/-/construction-loaders/Caterpillar/980H--c179tm2512m6509",
    "https://machineryline.info/-/excavators/Caterpillar/235--c163tm2512m51355",
]


def build_machineryline_urls():
    return list(MACHINERYLINE_URLS)


# --- eBay (ACTIVE once EBAY_CLIENT_ID/SECRET are in .env — official free API)
# One entry per (marketplace, item-location country, query). Region coverage is
# exactly the business's shipping lanes: USA, Canada, Europe, Australia.
# Queries stay BROAD (like Craigslist); scrapers/utils.classify does the precise
# catalog match and the eBay scraper screens out parts/manuals/toys.

EBAY_QUERIES = [
    "caterpillar wheel loader",
    "caterpillar loader",
    "caterpillar excavator",
    "caterpillar dump truck",
    "doosan excavator",
]

# (X-EBAY-C-MARKETPLACE-ID, itemLocationCountry)
EBAY_MARKETPLACES = [
    ("EBAY_US", "US"),
    ("EBAY_ENCA", "CA"),
    ("EBAY_AU", "AU"),
    # Europe — the marketplaces with meaningful heavy-equipment volume.
    ("EBAY_GB", "GB"),
    ("EBAY_DE", "DE"),
    ("EBAY_FR", "FR"),
    ("EBAY_IT", "IT"),
    ("EBAY_ES", "ES"),
    ("EBAY_NL", "NL"),
]


def build_ebay_targets():
    """Flatten marketplaces x queries into (marketplace, country, query) tuples."""
    return [
        (mp, country, q)
        for mp, country in EBAY_MARKETPLACES
        for q in EBAY_QUERIES
    ]


# --- Blocked / scaffolded sources (DISABLED until proxies are enabled) ------
# These are documented here so expansion is a config flip, not a rewrite.
# Do NOT trust these URLs/selectors until verified against a live fetch.

BLOCKED_SOURCES = {
    "Mascus": {  # pan-European (also some AU/global). WAF 403 confirmed 2026-07-08.
        "enabled": False,
        "region": "Europe",
        "urls": [
            "https://www.mascus.com/construction/used-wheel-loaders/caterpillar",
            "https://www.mascus.com/construction/used-excavators/caterpillar",
            "https://www.mascus.com/construction/used-excavators/doosan",
        ],
    },
    "MachineryTrader": {  # USA/Canada, Sandhills. Cloudflare 403.
        "enabled": False,
        "region": "USA",
        "urls": [
            "https://www.machinerytrader.com/listings/search?Category=1054&Country=USA",
            "https://www.machinerytrader.com/listings/search?Category=1056&Country=USA",
        ],
    },
    "IronPlanet": {  # auction, WAF-protected.
        "enabled": False,
        "region": "USA",
        "urls": [],
    },
    "Australia": {  # candidate sites (machines4u, tradeearthmovers) — UNVERIFIED.
        "enabled": False,
        "region": "Australia",
        "urls": [],  # populate only after a live fetch + robots.txt check
    },
}
