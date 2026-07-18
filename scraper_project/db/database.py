import sqlite3
import os
import logging
import hashlib
import secrets
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), 'machinery.db')

# Roles that may see money/finance data. Everyone else is an operator.
MANAGER_ROLES = {'manager', 'admin', 'owner'}
SESSION_TTL_DAYS = 14
_PBKDF2_ROUNDS = 200_000


def is_manager(role):
    return (role or '').strip().lower() in MANAGER_ROLES


def get_connection():
    """Open a connection with WAL enabled so the API, scraper cron, and harvester
    can read/write concurrently without 'database is locked' errors."""
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=30000')
    return conn


def _add_column_if_missing(cursor, table, column, coldef):
    """Idempotent column migration."""
    cursor.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in cursor.fetchall()}
    if column not in existing:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coldef}")


def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    # Create listings table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS listings (
            id TEXT PRIMARY KEY,
            url TEXT UNIQUE,
            make TEXT,
            model TEXT,
            year INTEGER,
            hours INTEGER,
            price TEXT,
            location TEXT,
            source TEXT,
            discovered_at TIMESTAMP,
            lat REAL,
            lng REAL,
            claimed_by TEXT,
            status TEXT DEFAULT 'Active',
            removal_reason TEXT,
            category TEXT,
            country TEXT,
            currency TEXT
        )
    ''')

    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            role TEXT,
            telegram_chat_id TEXT UNIQUE
        )
    ''')

    # Create config table for round-robin tracking
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    # Login sessions (Phase 4). Bearer token -> user, with expiry. Kept
    # server-side so a session can be revoked (logout) — simpler + safer than JWT
    # for a small team.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER,
            expires_at TIMESTAMP
        )
    ''')

    # Buyers (mini-CRM). A deal's buyer links here so we can see everything one
    # customer bought and what they still owe across all their deals.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS buyers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            phone TEXT,
            email TEXT,
            company TEXT,
            notes TEXT,
            created_at TIMESTAMP
        )
    ''')

    # Payments / installments. Egyptian equipment sales are often deposit +
    # installments, so payment is a list of receipts per deal, not a boolean.
    # Payment status (Paid/Partial/Pending) is DERIVED from these vs. sale price.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id TEXT,
            amount_egp REAL,
            paid_date TEXT,
            method TEXT,
            note TEXT,
            created_at TIMESTAMP
        )
    ''')

    # Company-level expenses (rent, salaries, commissions, the VPS, etc.) so we
    # can compute TRUE company profit = realized deal profit − expenses, not just
    # per-machine gross margin.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_date TEXT,
            category TEXT,
            amount_egp REAL,
            note TEXT,
            created_at TIMESTAMP
        )
    ''')

    # Documents per machine (customs papers, bill of lading, buyer ID, invoice,
    # inspection photos). Files live OUTSIDE the public /media mount and are
    # served only through an authenticated endpoint — some are sensitive.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id TEXT,
            stored_name TEXT,
            original_name TEXT,
            doc_type TEXT,
            content_type TEXT,
            size_bytes INTEGER,
            uploaded_by TEXT,
            uploaded_at TIMESTAMP
        )
    ''')

    # Deal finance (Phase 2). One row per owned machine. Models the real money
    # flow: buy abroad in a foreign currency + pay overseas freight in it, then
    # pay customs/clearance/repairs locally in EGP, then sell in EGP. fx_to_egp is
    # the EGP-per-1-foreign-unit rate the manager actually got (manual = accurate
    # to real cash, and no external FX dependency). Profit is computed in EGP.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS deal_finance (
            listing_id TEXT PRIMARY KEY,
            purchase_price REAL,
            purchase_currency TEXT,
            fx_to_egp REAL,
            shipping_cost REAL,
            customs_cost REAL,
            clearance_cost REAL,
            repair_cost REAL,
            sale_price_egp REAL,
            buyer TEXT,
            sale_date TEXT,
            payment_status TEXT,
            notes TEXT,
            updated_at TIMESTAMP
        )
    ''')

    # Rich detail for mirrored listings (Mascus etc.): seller contact + the local
    # paths of downloaded photos. Kept in a side table so the core insert path
    # used by every scraper stays untouched. One row per listing, populated only
    # for sources we mirror. `images` is a JSON array of web-relative media paths.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS listing_details (
            listing_id TEXT PRIMARY KEY,
            seller_name TEXT,
            seller_phone TEXT,
            seller_email TEXT,
            seller_company TEXT,
            seller_website TEXT,
            seller_address TEXT,
            images TEXT,
            description TEXT,
            updated_at TIMESTAMP
        )
    ''')

    # Deal pipeline (Phase 1): every status change is appended here so the
    # Reports page can compute funnel timings (time-to-claim, time-to-close)
    # and per-operator close rates from real history, not just current state.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id TEXT,
            status TEXT,
            changed_by TEXT,
            changed_at TIMESTAMP
        )
    ''')

    # Migrations for databases created before these columns existed.
    # Consolidated here so the API layer doesn't need to ALTER on every request.
    _add_column_if_missing(cursor, 'listings', 'lat', 'REAL')
    _add_column_if_missing(cursor, 'listings', 'lng', 'REAL')
    _add_column_if_missing(cursor, 'listings', 'claimed_by', 'TEXT')
    _add_column_if_missing(cursor, 'listings', 'status', "TEXT DEFAULT 'Active'")
    _add_column_if_missing(cursor, 'listings', 'removal_reason', 'TEXT')
    _add_column_if_missing(cursor, 'listings', 'category', 'TEXT')
    _add_column_if_missing(cursor, 'listings', 'country', 'TEXT')
    _add_column_if_missing(cursor, 'listings', 'currency', 'TEXT')
    _add_column_if_missing(cursor, 'listings', 'lost_reason', 'TEXT')
    _add_column_if_missing(cursor, 'listings', 'status_changed_at', 'TIMESTAMP')
    _add_column_if_missing(cursor, 'users', 'telegram_chat_id', 'TEXT')
    # Login credentials (Phase 4). Stored as PBKDF2-HMAC-SHA256, never plaintext.
    _add_column_if_missing(cursor, 'users', 'password_hash', 'TEXT')
    _add_column_if_missing(cursor, 'users', 'password_salt', 'TEXT')
    # Commission %: an operator earns this share of the PROFIT on deals they close.
    _add_column_if_missing(cursor, 'users', 'commission_pct', 'REAL DEFAULT 0')
    # Link a deal's buyer to the buyers table (kept alongside the legacy free-text
    # 'buyer' field so old rows still display).
    _add_column_if_missing(cursor, 'deal_finance', 'buyer_id', 'INTEGER')

    # Pipeline migration: legacy 'Completed' (old "Mark as Purchased" button)
    # becomes the 'Purchased' stage of the new pipeline. Idempotent.
    cursor.execute("UPDATE listings SET status = 'Purchased' WHERE status = 'Completed'")

    # Indexes for the dashboard's common filters (status feed, region/category reports).
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_listings_status_time ON listings(status, discovered_at)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_listings_cat_country ON listings(category, country)')

    conn.commit()
    conn.close()


def get_last_assigned_index():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT value FROM config WHERE key = ?', ('last_employee_index',))
    row = cursor.fetchone()
    conn.close()
    return int(row[0]) if row else -1


def set_last_assigned_index(index):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO config (key, value)
        VALUES (?, ?)
    ''', ('last_employee_index', str(index)))
    conn.commit()
    conn.close()


def get_next_assignee(chat_ids):
    """Advance the round-robin pointer and return the next chat id to assign to.

    Shared by both the scraper (main.py) and the harvester push endpoint (api.py)
    so every new listing goes to exactly one operator, in rotation. Returns None
    if there are no chat ids configured.
    """
    if not chat_ids:
        return None
    next_index = (get_last_assigned_index() + 1) % len(chat_ids)
    set_last_assigned_index(next_index)
    return chat_ids[next_index]


def is_new_listing(listing_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM listings WHERE id = ?', (listing_id,))
    exists = cursor.fetchone() is not None
    conn.close()
    return not exists


# ---- Auth (Phase 4): passwords + sessions -------------------------------

def _hash_password(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                               bytes.fromhex(salt), _PBKDF2_ROUNDS).hex()


def set_user_password(name, password):
    """Set (or reset) a user's login password. Returns False if no such user."""
    salt = secrets.token_hex(16)
    pwd_hash = _hash_password(password, salt)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET password_hash = ?, password_salt = ? WHERE name = ?",
                   (pwd_hash, salt, name))
    changed = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return changed


def verify_login(name, password):
    """Return the user dict on correct credentials, else None. Constant-time
    compare to avoid leaking whether the hash matched."""
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE name = ?", (name,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    u = dict(row)
    if not u.get('password_hash') or not u.get('password_salt'):
        return None  # no password set yet
    candidate = _hash_password(password, u['password_salt'])
    if not secrets.compare_digest(candidate, u['password_hash']):
        return None
    return {'id': u['id'], 'name': u['name'], 'role': u['role']}


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(days=SESSION_TTL_DAYS)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                   (token, user_id, expires))
    conn.commit()
    conn.close()
    return token


def get_session_user(token):
    """Resolve a bearer token to a live user dict, or None if missing/expired."""
    if not token:
        return None
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT u.id, u.name, u.role, s.expires_at
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
    ''', (token,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    try:
        if datetime.fromisoformat(str(row['expires_at'])) < datetime.now():
            delete_session(token)
            return None
    except (ValueError, TypeError):
        return None
    return {'id': row['id'], 'name': row['name'], 'role': row['role']}


def delete_session(token):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def get_user_by_name(name):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_user_admin(user_id, role=None, commission_pct=None):
    """Manager edit of a user's role and/or commission %. Only provided fields change."""
    sets, vals = [], []
    if role is not None:
        sets.append("role = ?"); vals.append(role)
    if commission_pct is not None:
        sets.append("commission_pct = ?"); vals.append(commission_pct)
    if not sets:
        return False
    vals.append(user_id)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", vals)
    changed = cur.rowcount > 0
    conn.commit()
    conn.close()
    return changed


def set_password_by_id(user_id, password):
    """Reset a user's password by id (manager action). Returns False if no user."""
    salt = secrets.token_hex(16)
    pwd_hash = _hash_password(password, salt)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
                (pwd_hash, salt, user_id))
    changed = cur.rowcount > 0
    conn.commit()
    conn.close()
    return changed


def get_active_chat_ids():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL')
        rows = cursor.fetchall()
        chat_ids = [row[0] for row in rows]
    except sqlite3.OperationalError:
        chat_ids = []
    conn.close()
    return chat_ids


# Ordered longest/most-specific first so 'C$'/'A$' are tested before bare '$'.
_CURRENCY_SYMBOLS = [('C$', 'CAD'), ('A$', 'AUD'), ('€', 'EUR'), ('£', 'GBP'), ('kr', 'SEK'), ('$', 'USD')]


def _infer_currency(price):
    """Best-effort currency tag from a price string's symbol (or None)."""
    if not price:
        return None
    p = str(price)
    for sym, code in _CURRENCY_SYMBOLS:
        if sym in p:
            return code
    return None


def _insert_one(cursor, listing):
    """Insert a single listing dict (geocoded, category/country/currency tagged).
    Returns True if a new row was inserted. Shared by add_listing + save_listings."""
    from geocode import get_lat_lng

    # None => transient geocode failure; store NULL so a later read retries.
    coords = get_lat_lng(listing.get('location'))
    lat, lng = coords if coords is not None else (None, None)
    currency = listing.get('currency') or _infer_currency(listing.get('price'))

    cursor.execute('''
        INSERT OR IGNORE INTO listings
        (id, url, make, model, year, hours, price, location, source, discovered_at,
         lat, lng, status, category, country, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
    ''', (
        listing['id'], listing['url'], listing['make'], listing['model'],
        listing.get('year'), listing.get('hours'), listing.get('price'),
        listing.get('location'), listing['source'], datetime.now(),
        lat, lng, listing.get('category'), listing.get('country'), currency
    ))
    return cursor.rowcount > 0


def add_listing(listing):
    """Insert a single listing, geocoding its location once at write time."""
    conn = get_connection()
    cursor = conn.cursor()
    _insert_one(cursor, listing)
    conn.commit()
    conn.close()


def create_manual_listing(data):
    """Create a deal entered by hand (heard by phone/email, not scraped). Returns
    the new listing id. source='Manual'. Flows through the same pipeline/finance
    as scraped deals. Seller contact (if given) goes to listing_details."""
    import uuid
    lid = 'man_' + uuid.uuid4().hex[:12]
    listing = {
        'id': lid,
        'url': f'manual://{lid}',   # placeholder — satisfies the UNIQUE(url) key
        'make': (data.get('make') or '').strip(),
        'model': (data.get('model') or '').strip(),
        'year': data.get('year'),
        'hours': data.get('hours'),
        'price': data.get('price'),
        'location': (data.get('location') or '').strip() or 'Unknown',
        'source': 'Manual',
        'category': data.get('category'),
        'country': data.get('country'),
        'currency': data.get('currency'),
    }
    conn = get_connection()
    cursor = conn.cursor()
    _insert_one(cursor, listing)
    conn.commit()
    conn.close()

    # Optional seller contact → detail table (same shape as mirrored listings).
    if data.get('seller_name') or data.get('seller_phone') or data.get('seller_email'):
        save_listing_detail(lid, {
            'seller_name': data.get('seller_name'),
            'seller_phone': data.get('seller_phone'),
            'seller_email': data.get('seller_email'),
            'seller_company': data.get('seller_company'),
            'seller_website': None, 'seller_address': None,
            'images': [], 'description': data.get('notes'),
        })
    return lid


def save_listings(listings):
    """Insert a batch of listing dicts (from the harvester push endpoint).

    Geocodes each new location once and returns the number of rows actually
    inserted (i.e. listings that were not already in the DB)."""
    new_count = 0
    conn = get_connection()
    cursor = conn.cursor()
    for listing in listings:
        listing_id = listing.get('id')
        if not listing_id:
            continue
        # Skip if we've already seen it.
        cursor.execute('SELECT 1 FROM listings WHERE id = ?', (listing_id,))
        if cursor.fetchone():
            continue
        if _insert_one(cursor, listing):
            new_count += 1
    conn.commit()
    conn.close()
    return new_count


# The deal pipeline, in order. 'Removed' is junk (bad listing), NOT a lost deal,
# so it is excluded from close-rate math. 'Lost' requires a reason.
PIPELINE_STATUSES = [
    'Active', 'Claimed', 'Contacted', 'Negotiating',
    'Purchased', 'Shipping', 'Customs', 'In Stock', 'Sold',
    'Lost', 'Removed',
]


def set_listing_status(listing_id, status, reason=None, changed_by=None):
    """Move a listing to a new pipeline status and append to status_history.

    Returns False if the listing doesn't exist. Raises ValueError on an unknown
    status so the API layer can 400 instead of writing garbage."""
    if status not in PIPELINE_STATUSES:
        raise ValueError(f"Unknown status: {status}")
    now = datetime.now()
    conn = get_connection()
    cursor = conn.cursor()
    if status == 'Lost':
        cursor.execute(
            "UPDATE listings SET status = ?, lost_reason = ?, status_changed_at = ? WHERE id = ?",
            (status, reason, now, listing_id))
    elif status == 'Removed':
        cursor.execute(
            "UPDATE listings SET status = ?, removal_reason = ?, status_changed_at = ? WHERE id = ?",
            (status, reason, now, listing_id))
    else:
        cursor.execute(
            "UPDATE listings SET status = ?, status_changed_at = ? WHERE id = ?",
            (status, now, listing_id))
    changed = cursor.rowcount > 0
    if changed:
        cursor.execute(
            "INSERT INTO status_history (listing_id, status, changed_by, changed_at) VALUES (?, ?, ?, ?)",
            (listing_id, status, changed_by, now))
    conn.commit()
    conn.close()
    return changed


def save_listing_detail(listing_id, detail):
    """Upsert the rich detail (seller contact + mirrored image paths) for a
    listing. `detail['images']` may be a list (stored as JSON) or already a
    string. Safe to call repeatedly (re-enrichment overwrites)."""
    import json
    images = detail.get('images')
    if isinstance(images, (list, tuple)):
        images = json.dumps(list(images))
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO listing_details
            (listing_id, seller_name, seller_phone, seller_email, seller_company,
             seller_website, seller_address, images, description, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(listing_id) DO UPDATE SET
            seller_name=excluded.seller_name,
            seller_phone=excluded.seller_phone,
            seller_email=excluded.seller_email,
            seller_company=excluded.seller_company,
            seller_website=excluded.seller_website,
            seller_address=excluded.seller_address,
            images=excluded.images,
            description=excluded.description,
            updated_at=excluded.updated_at
    ''', (
        listing_id, detail.get('seller_name'), detail.get('seller_phone'),
        detail.get('seller_email'), detail.get('seller_company'),
        detail.get('seller_website'), detail.get('seller_address'),
        images, detail.get('description'), datetime.now(),
    ))
    conn.commit()
    conn.close()


def get_listing_detail(listing_id):
    """Return the detail row for a listing as a dict (images parsed to a list),
    or None if there's no mirrored detail for it."""
    import json
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM listing_details WHERE listing_id = ?', (listing_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    try:
        d['images'] = json.loads(d.get('images') or '[]')
    except (ValueError, TypeError):
        d['images'] = []
    return d


# ---- Deal finance (Phase 2): costs, sale, profit in EGP -----------------

# Machines you actually own (money applies). Everything earlier = not bought yet.
OWNED_STATUSES = ('Purchased', 'Shipping', 'Customs', 'In Stock', 'Sold')

_FINANCE_FIELDS = (
    'purchase_price', 'purchase_currency', 'fx_to_egp', 'shipping_cost',
    'customs_cost', 'clearance_cost', 'repair_cost', 'sale_price_egp',
    'buyer', 'buyer_id', 'sale_date', 'notes',
)


def _num(v):
    """Coerce to float; blank/None -> 0.0 (so partial entry still computes)."""
    try:
        return float(v) if v not in (None, '') else 0.0
    except (TypeError, ValueError):
        return 0.0


def compute_finance(fin):
    """Given a finance dict, return EGP totals. Single source of profit math so
    the entry page and the profit board agree. Foreign side (purchase+shipping)
    is converted with fx_to_egp; local side (customs/clearance/repair/sale) is
    already EGP. Profit only meaningful once a sale price is entered.

    CRITICAL: never invent an FX rate. If the purchase currency is not EGP and a
    foreign amount exists but no valid fx_to_egp is entered, the EGP cost is
    UNKNOWN — return None + needs_fx rather than a fabricated (and wildly wrong)
    number. A missing rate must show a warning, never a fake profit."""
    currency = (fin.get('purchase_currency') or 'USD').strip().upper()
    fx_raw = _num(fin.get('fx_to_egp'))
    foreign_amount = _num(fin.get('purchase_price')) + _num(fin.get('shipping_cost'))
    local_egp = (_num(fin.get('customs_cost')) + _num(fin.get('clearance_cost'))
                 + _num(fin.get('repair_cost')))
    sale = _num(fin.get('sale_price_egp'))
    sale_out = sale if sale > 0 else None

    # An FX rate is only required when we have a foreign amount in a non-EGP
    # currency. EGP purchases (or no foreign amount) need no conversion.
    needs_fx = currency != 'EGP' and foreign_amount > 0 and fx_raw <= 0
    if needs_fx:
        return {
            'foreign_cost_egp': None, 'local_cost_egp': round(local_egp, 2),
            'total_cost_egp': None, 'sale_price_egp': sale_out,
            'profit_egp': None, 'margin_pct': None, 'needs_fx': True,
        }

    fx = 1.0 if currency == 'EGP' else (fx_raw if fx_raw > 0 else 1.0)
    foreign_egp = foreign_amount * fx
    total_cost_egp = foreign_egp + local_egp
    profit_egp = (sale - total_cost_egp) if sale > 0 else None
    margin_pct = round(profit_egp / sale * 100, 1) if (sale > 0 and profit_egp is not None) else None
    return {
        'foreign_cost_egp': round(foreign_egp, 2),
        'local_cost_egp': round(local_egp, 2),
        'total_cost_egp': round(total_cost_egp, 2),
        'sale_price_egp': sale_out,
        'profit_egp': round(profit_egp, 2) if profit_egp is not None else None,
        'margin_pct': margin_pct,
        'needs_fx': False,
    }


def save_deal_finance(listing_id, data):
    """Upsert finance for a listing. Only known fields are written."""
    vals = {k: data.get(k) for k in _FINANCE_FIELDS}
    cols = ', '.join(_FINANCE_FIELDS)
    placeholders = ', '.join('?' for _ in _FINANCE_FIELDS)
    updates = ', '.join(f"{k}=excluded.{k}" for k in _FINANCE_FIELDS)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(f'''
        INSERT INTO deal_finance (listing_id, {cols}, updated_at)
        VALUES (?, {placeholders}, ?)
        ON CONFLICT(listing_id) DO UPDATE SET {updates}, updated_at=excluded.updated_at
    ''', (listing_id, *[vals[k] for k in _FINANCE_FIELDS], datetime.now()))
    conn.commit()
    conn.close()


def get_deal_finance(listing_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM deal_finance WHERE listing_id = ?", (listing_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def derive_payment(sale_price_egp, total_paid):
    """Payment status + balance from installments vs. the sale price."""
    sale = _num(sale_price_egp)
    paid = _num(total_paid)
    if sale <= 0:
        return {'total_paid': round(paid, 2), 'balance': None, 'payment_status': None}
    balance = round(sale - paid, 2)
    if paid <= 0:
        status = 'Pending'
    elif paid >= sale:
        status = 'Paid'
    else:
        status = 'Partial'
    return {'total_paid': round(paid, 2), 'balance': balance, 'payment_status': status}


def get_owned_deals():
    """Every owned machine (Purchased+) joined with its finance row (may be
    empty) + computed EGP figures + payment rollup + buyer. Powers the manager
    Finance page + profit board.

    purchased_at = first time the deal hit 'Purchased' (from status_history);
    days_to_sell = sale_date - purchased_at when both are known."""
    placeholders = ', '.join('?' for _ in OWNED_STATUSES)
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(f'''
        SELECT l.id, l.make, l.model, l.year, l.category, l.country, l.source,
               l.status, l.claimed_by, l.price AS asking_price, l.status_changed_at,
               f.purchase_price, f.purchase_currency, f.fx_to_egp, f.shipping_cost,
               f.customs_cost, f.clearance_cost, f.repair_cost, f.sale_price_egp,
               f.buyer, f.buyer_id, f.sale_date, f.notes, f.updated_at,
               b.name AS buyer_name, b.phone AS buyer_phone, b.company AS buyer_company,
               (SELECT MIN(h.changed_at) FROM status_history h
                WHERE h.listing_id = l.id AND h.status = 'Purchased') AS purchased_at,
               (SELECT COALESCE(SUM(p.amount_egp), 0) FROM payments p
                WHERE p.listing_id = l.id) AS total_paid
        FROM listings l
        LEFT JOIN deal_finance f ON f.listing_id = l.id
        LEFT JOIN buyers b ON b.id = f.buyer_id
        WHERE l.status IN ({placeholders})
        ORDER BY l.status_changed_at DESC
    ''', OWNED_STATUSES)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    for r in rows:
        r['finance'] = compute_finance(r)
        pay = derive_payment(r['finance'].get('sale_price_egp'), r.get('total_paid'))
        r.update(pay)  # total_paid (rounded), balance, payment_status
        # Days from purchase to sale (needs both dates; legacy rows may lack history).
        days = None
        if r.get('purchased_at') and r.get('sale_date'):
            try:
                bought = datetime.fromisoformat(str(r['purchased_at'])).date()
                sold = datetime.fromisoformat(str(r['sale_date'])[:10]).date()
                days = max((sold - bought).days, 0)
            except (ValueError, TypeError):
                days = None
        r['days_to_sell'] = days
    return rows


# ---- Buyers (mini-CRM) ----

def list_buyers():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM buyers ORDER BY name")]
    conn.close()
    return rows


def add_buyer(data):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''INSERT INTO buyers (name, phone, email, company, notes, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (data.get('name'), data.get('phone'), data.get('email'),
                 data.get('company'), data.get('notes'), datetime.now()))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def update_buyer(buyer_id, data):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''UPDATE buyers SET name=?, phone=?, email=?, company=?, notes=? WHERE id=?''',
                (data.get('name'), data.get('phone'), data.get('email'),
                 data.get('company'), data.get('notes'), buyer_id))
    conn.commit()
    changed = cur.rowcount > 0
    conn.close()
    return changed


# ---- Payments / installments ----

def list_payments(listing_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM payments WHERE listing_id = ? ORDER BY paid_date, id", (listing_id,))]
    conn.close()
    return rows


def add_payment(listing_id, data):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''INSERT INTO payments (listing_id, amount_egp, paid_date, method, note, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (listing_id, data.get('amount_egp'), data.get('paid_date'),
                 data.get('method'), data.get('note'), datetime.now()))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def delete_payment(payment_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM payments WHERE id = ?", (payment_id,))
    conn.commit()
    conn.close()


# ---- Recent activity feed (manager Overview) ----

def get_recent_activity(limit=15):
    """A merged, newest-first feed of what's happening: deal stage changes and
    payments received. Powers the manager Overview home screen."""
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    events = []
    for r in conn.execute('''
        SELECT h.changed_at AS ts, h.status, h.changed_by, l.make, l.model
        FROM status_history h JOIN listings l ON l.id = h.listing_id
        ORDER BY h.changed_at DESC LIMIT ?''', (limit,)):
        d = dict(r)
        events.append({
            'type': 'status', 'ts': d['ts'],
            'text': f"{d['make']} {d['model']} → {d['status']}",
            'who': d['changed_by'],
        })
    for r in conn.execute('''
        SELECT p.paid_date AS ts, p.amount_egp, l.make, l.model
        FROM payments p JOIN listings l ON l.id = p.listing_id
        ORDER BY p.id DESC LIMIT ?''', (limit,)):
        d = dict(r)
        events.append({
            'type': 'payment', 'ts': d['ts'],
            'text': f"Payment received · {d['make']} {d['model']}",
            'amount_egp': d['amount_egp'],
        })
    conn.close()
    # newest first; payment rows may carry only a date, so guard the sort key
    events.sort(key=lambda e: str(e.get('ts') or ''), reverse=True)
    return events[:limit]


# ---- Documents per machine ----

def add_document(listing_id, stored_name, original_name, doc_type, content_type, size_bytes, uploaded_by):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''INSERT INTO documents
        (listing_id, stored_name, original_name, doc_type, content_type, size_bytes, uploaded_by, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
        (listing_id, stored_name, original_name, doc_type, content_type, size_bytes, uploaded_by, datetime.now()))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def list_documents(listing_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT id, listing_id, original_name, doc_type, content_type, size_bytes, uploaded_by, uploaded_at "
        "FROM documents WHERE listing_id = ? ORDER BY uploaded_at DESC", (listing_id,))]
    conn.close()
    return rows


def get_document(document_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_document(document_id):
    doc = get_document(document_id)
    conn = get_connection()
    conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    conn.commit()
    conn.close()
    return doc


# ---- Company expenses ----

def list_expenses():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM expenses ORDER BY expense_date DESC, id DESC")]
    conn.close()
    return rows


def add_expense(data):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''INSERT INTO expenses (expense_date, category, amount_egp, note, created_at)
                   VALUES (?, ?, ?, ?, ?)''',
                (data.get('expense_date'), data.get('category'),
                 data.get('amount_egp'), data.get('note'), datetime.now()))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def delete_expense(expense_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
    conn.commit()
    conn.close()


def get_all_recent_listings(hours=24):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT make, model, year, hours, price, location, url, source
        FROM listings
        WHERE discovered_at >= datetime('now', ?)
    ''', (f'-{hours} hours',))
    columns = [col[0] for col in cursor.description]
    results = [dict(zip(columns, row)) for row in cursor.fetchall()]
    conn.close()
    return results


if __name__ == '__main__':
    init_db()
    print("Database initialized.")
