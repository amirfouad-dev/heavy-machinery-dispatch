import os
import argparse
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv(override=True)

from db.database import (
    init_db, is_new_listing, add_listing, get_next_assignee,
    get_active_chat_ids, save_listing_detail,
)
from notifications.telegram_notifier import TelegramNotifier
from scrapers.machinerytrader_scraper import MachineryTraderScraper
from scrapers.url_validator import is_valid_link
from scrapers.craigslist_scraper import CraigslistScraper
from scrapers.mascus_scraper import MascusScraper
from scrapers.ebay_scraper import EbayScraper
from scrapers.tradeearthmovers_scraper import TradeEarthmoversScraper
from scrapers.machineryline_scraper import MachinerylineScraper
from targets import (
    build_craigslist_urls, build_mascus_urls, build_ebay_targets,
    build_tradeearthmovers_urls, build_machineryline_urls,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Public base URL of the dashboard. Mirrored-source alerts (Mascus) link here
# instead of the source site, because the source geo-blocks the employees' region.
DASHBOARD_URL = os.environ.get('DASHBOARD_URL', 'http://YOUR_SERVER_IP:8085').rstrip('/')

def run_scrapers():
    """Run all configured scrapers and process new listings."""

    # Targets live in targets.py (config, not code). Craigslist (USA/CAN) is the
    # free public source; Mascus (EU/global) is reachable server-side from the
    # Paris VPS and is mirrored (photos + seller contact) so Egypt staff can view
    # listings the source geo-blocks. Other blocked sources stay scaffolded.
    scrapers = [
        (CraigslistScraper(), build_craigslist_urls()),
        (MascusScraper(), build_mascus_urls()),
        (TradeEarthmoversScraper(), build_tradeearthmovers_urls()),
        (MachinerylineScraper(), build_machineryline_urls()),
    ]

    # eBay (USA/CAN/EU/AU via the official free Browse API) joins the rotation
    # only when API credentials exist — skipped silently otherwise so the
    # "0 listings" health alert doesn't cry wolf.
    if os.environ.get('EBAY_CLIENT_ID') and os.environ.get('EBAY_CLIENT_SECRET'):
        scrapers.append((EbayScraper(), build_ebay_targets()))
    else:
        logger.info("eBay source skipped: EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set in .env")

    telegram_notifier = TelegramNotifier()
    
    # Fetch dynamic chat IDs from database
    chat_ids = get_active_chat_ids()
    
    if not chat_ids:
        # Fallback to .env if DB is empty
        chat_ids_str = os.environ.get('TELEGRAM_CHAT_IDS', '')
        chat_ids = [cid.strip() for cid in chat_ids_str.split(',') if cid.strip()]
        
    if not chat_ids:
        logger.warning("No TELEGRAM_CHAT_IDS configured or found in DB. Running in Preview Mode.")
        chat_ids = ['TERMINAL_PREVIEW']
        
    # Admin chat for operational alerts (falls back to the first configured chat id).
    admin_chat_id = os.environ.get('ADMIN_CHAT_ID') or (chat_ids[0] if chat_ids else None)

    for scraper, search_urls in scrapers:
        logger.info(f"Running scraper: {scraper.source_name}")

        # Some scrapers (Mascus) do heavy per-listing enrichment; cap how many
        # NEW ones we fully process per run so the first backfill is spread over
        # several cron cycles instead of running for an hour.
        enrich_cap = getattr(scraper, 'enrich_cap', None)
        new_this_run = 0

        seen_count = 0
        for listing in scraper.scrape(search_urls):
            seen_count += 1
            listing_id = listing['id']

            if is_new_listing(listing_id):
                url = listing.get('url')
                if not is_valid_link(url):
                    logger.warning(f"Skipping listing {listing_id} because URL failed validation check: {url}")
                    continue

                if enrich_cap is not None and new_this_run >= enrich_cap:
                    logger.info(f"{scraper.source_name}: hit enrich cap ({enrich_cap}); deferring rest to next run.")
                    break

                logger.info(f"New listing found: {listing.get('make')} {listing.get('model')}")

                # Enrich mirrored sources: fetch seller contact + download photos
                # locally. Only for NEW listings, and never fatal.
                detail = None
                if hasattr(scraper, 'enrich'):
                    try:
                        detail = scraper.enrich(listing)
                    except Exception as e:
                        logger.error(f"Enrichment failed for {listing_id}: {e}")

                # Alert the next employee in round-robin. For mirrored sources the
                # link must point at OUR dashboard (source is geo-blocked for them).
                target_chat_id = get_next_assignee(chat_ids)
                alert = listing
                if detail is not None:
                    alert = {**listing, 'url': f"{DASHBOARD_URL}/?listing={listing_id}"}
                telegram_notifier.send_alert(alert, target_chat_id)

                # Persist the core row, then the mirrored detail (if any).
                add_listing(listing)
                if detail is not None:
                    save_listing_detail(listing_id, detail)

                new_this_run += 1
            else:
                logger.debug(f"Listing {listing_id} already exists in database.")

        # Health check: a scraper returning nothing usually means the site changed
        # its markup or is blocking us. Alert an admin so it doesn't fail silently.
        if seen_count == 0:
            logger.warning(f"Scraper '{scraper.source_name}' returned 0 listings — site markup change or block?")
            if admin_chat_id and admin_chat_id != 'TERMINAL_PREVIEW':
                telegram_notifier.send_text(
                    admin_chat_id,
                    f"⚠️ Scraper '{scraper.source_name}' returned 0 listings. "
                    f"The site may have changed its layout or is blocking requests."
                )

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Heavy Machinery Scraper & Notifier")
    parser.add_argument('--run', action='store_true', help='Run scrapers and send Telegram alerts')
    parser.add_argument('--init-db', action='store_true', help='Initialize database')
    
    args = parser.parse_args()
    
    if args.init_db:
        init_db()
        logger.info("Database initialized successfully.")
    
    if args.run:
        # Note: Ensure db is initialized before running
        if not os.path.exists(os.path.join(os.path.dirname(__file__), 'db', 'machinery.db')):
            init_db()
        run_scrapers()
        
    if not (args.run or args.init_db):
        parser.print_help()
