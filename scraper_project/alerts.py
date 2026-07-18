"""Daily manager digest (run by cron): chases money and flags stuck capital.

- Overdue payments: a SOLD machine still owed money, with no payment in
  OVERDUE_DAYS. Chasing installments is the lifeblood — the system nags for you.
- Aging inventory: an owned machine sitting too long in a stage (in transit /
  customs / yard), because idle capital costs money.

Sends ONE Telegram message to the admin/manager chat. Silent if nothing's due.
"""
import os
import sqlite3
import logging
from datetime import datetime, date

from dotenv import load_dotenv
load_dotenv(override=True)

from db.database import get_owned_deals, get_connection
from notifications.telegram_notifier import TelegramNotifier

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

OVERDUE_DAYS = int(os.environ.get('OVERDUE_DAYS', '30'))
# Days a machine can sit in a stage before it's flagged as aging.
AGING_DAYS = {'Shipping': 45, 'Customs': 21, 'In Stock': 60}


def _days_since(value):
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value)[:19]).date() if len(str(value)) > 10 \
            else date.fromisoformat(str(value)[:10])
        return (date.today() - d).days
    except (ValueError, TypeError):
        return None


def _last_payment_date(listing_id):
    conn = get_connection()
    row = conn.execute("SELECT MAX(paid_date) FROM payments WHERE listing_id = ?", (listing_id,)).fetchone()
    conn.close()
    return row[0] if row else None


def _fmt(n):
    try:
        return f"E£{int(round(float(n))):,}"
    except (TypeError, ValueError):
        return "—"


def build_digest():
    deals = get_owned_deals()
    overdue, aging = [], []

    for d in deals:
        machine = f"{d['make']} {d['model']}"
        # --- overdue payments (sold, still owed) ---
        if d.get('status') == 'Sold' and (d.get('balance') or 0) > 0:
            last = _last_payment_date(d['id']) or d.get('sale_date')
            days = _days_since(last)
            if days is not None and days >= OVERDUE_DAYS:
                who = d.get('buyer_name') or 'buyer (unassigned)'
                overdue.append(f"⚠️ *{who}* owes {_fmt(d['balance'])} on {machine} — {days}d since last payment")

        # --- aging inventory (owned, not sold, stuck in a stage) ---
        stage = d.get('status')
        if stage in AGING_DAYS:
            days = _days_since(d.get('status_changed_at'))
            if days is not None and days >= AGING_DAYS[stage]:
                aging.append(f"🏗 {machine} stuck in *{stage}* {days}d")

    return overdue, aging


def main():
    overdue, aging = build_digest()
    if not overdue and not aging:
        logger.info("Nothing overdue or aging — no digest sent.")
        return

    lines = ["📋 *DAILY BUSINESS DIGEST*", ""]
    if overdue:
        lines.append("*Money owed to you:*")
        lines += overdue
        lines.append("")
    if aging:
        lines.append("*Machines sitting too long:*")
        lines += aging
    message = "\n".join(lines)

    admin = os.environ.get('ADMIN_CHAT_ID')
    if not admin:
        logger.warning("ADMIN_CHAT_ID not set — printing digest instead:\n" + message)
        return
    TelegramNotifier().send_text(admin, message, parse_mode='Markdown')
    logger.info(f"Digest sent to {admin} ({len(overdue)} overdue, {len(aging)} aging).")


if __name__ == '__main__':
    main()
