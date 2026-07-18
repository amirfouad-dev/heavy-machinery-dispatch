from fastapi import FastAPI, HTTPException, Header, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import sqlite3
import os
import re
import uuid
import shutil
import logging

from dotenv import load_dotenv
# Load .env so API_KEY, ADMIN_CHAT_ID, ALLOWED_ORIGINS etc. are actually applied
# (the systemd unit runs uvicorn directly and does not inject them otherwise).
load_dotenv(override=True)

from geocode import get_lat_lng
from db.database import (
    init_db, get_connection, DB_PATH, save_listings, get_active_chat_ids,
    get_next_assignee, get_listing_detail, set_listing_status, PIPELINE_STATUSES,
    verify_login, create_session, get_session_user, delete_session, is_manager,
    set_user_password, get_user_by_name, update_user_admin, set_password_by_id,
    create_manual_listing,
    save_deal_finance, get_deal_finance, get_owned_deals, compute_finance,
    list_buyers, add_buyer, update_buyer, list_payments, add_payment, delete_payment,
    list_expenses, add_expense, delete_expense,
    add_document, list_documents, get_document, delete_document,
    get_recent_activity,
)
from notifications.telegram_notifier import TelegramNotifier

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Ensure the schema exists / is migrated before serving requests.
try:
    init_db()
except Exception as e:
    logger.warning(f"init_db on startup failed: {e}")

app = FastAPI(title="Heavy Machinery API")

# CORS: default to permissive for local dev, but allow locking down in production
# by setting ALLOWED_ORIGINS (comma-separated) in the environment.
_allowed = os.environ.get('ALLOWED_ORIGINS', '*').strip()
if _allowed == '*':
    _origins = ['*']
    _allow_credentials = False  # browsers reject credentials + wildcard
else:
    _origins = [o.strip() for o in _allowed.split(',') if o.strip()]
    _allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mirrored listing photos (Mascus etc.) are downloaded to MEDIA_ROOT and served
# by the authenticated /media/{path} endpoint below — seller data and photos are
# the business's sourcing edge, so nothing here is public. Must match the
# scraper's MEDIA_ROOT (scraper_project/media by default).
MEDIA_ROOT = os.environ.get('MEDIA_ROOT', os.path.join(os.path.dirname(__file__), 'media'))
os.makedirs(MEDIA_ROOT, exist_ok=True)

# Documents (customs papers, IDs, invoices) live OUTSIDE /media — some are
# sensitive, so they're only reachable via the authenticated download endpoint.
DOCS_ROOT = os.environ.get('DOCS_ROOT', os.path.join(os.path.dirname(__file__), 'docs_store'))
os.makedirs(DOCS_ROOT, exist_ok=True)
MAX_DOC_BYTES = 25 * 1024 * 1024  # 25 MB per file

# --- Auth -------------------------------------------------------------------
# Opt-in: if API_KEY is unset, auth is disabled (backward compatible). Set
# API_KEY in .env to require an X-API-Key header on all mutating endpoints.
API_KEY = os.environ.get('API_KEY')
if not API_KEY:
    logger.warning("API_KEY is not set — mutating endpoints are UNAUTHENTICATED. "
                   "Set API_KEY in .env to protect this server.")


def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not API_KEY:
        return  # auth disabled
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ---- User auth (Phase 4) ---------------------------------------------------
# Login sessions gate the human dashboard. Money/finance endpoints (Phase 2/3)
# require a MANAGER session — enforced here on the server, so hiding a UI tab is
# not the only thing protecting profit data.

def _bearer_token(authorization: Optional[str]):
    if authorization and authorization.lower().startswith('bearer '):
        return authorization[7:].strip()
    return None


def current_user(authorization: Optional[str] = Header(None)):
    """Resolve the logged-in user from the Authorization: Bearer header, or None."""
    return get_session_user(_bearer_token(authorization))


def require_login(authorization: Optional[str] = Header(None)):
    user = get_session_user(_bearer_token(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def require_manager(authorization: Optional[str] = Header(None)):
    user = get_session_user(_bearer_token(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    if not is_manager(user.get('role')):
        raise HTTPException(status_code=403, detail="Manager access required")
    return user


class LoginRequest(BaseModel):
    name: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/auth/login")
def login(req: LoginRequest):
    user = verify_login(req.name, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid name or password")
    token = create_session(user['id'])
    return {"token": token, "name": user['name'], "role": user['role'],
            "is_manager": is_manager(user['role'])}


@app.post("/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    token = _bearer_token(authorization)
    if token:
        delete_session(token)
    return {"success": True}


@app.get("/auth/me")
def whoami(user: Optional[dict] = Depends(current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return {"name": user['name'], "role": user['role'], "is_manager": is_manager(user['role'])}


@app.post("/auth/change-password")
def change_password(payload: ChangePasswordRequest, user: dict = Depends(require_login)):
    """Any logged-in user changes their OWN password (must confirm the current one)."""
    if not verify_login(user['name'], payload.current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password or '') < 4:
        raise HTTPException(status_code=400, detail="New password too short")
    set_user_password(user['name'], payload.new_password)
    return {"success": True}


def _db():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    return conn


class ClaimRequest(BaseModel):
    listing_id: str
    employee_name: str


class RemoveRequest(BaseModel):
    reason: str


class StatusRequest(BaseModel):
    status: str
    reason: Optional[str] = None      # required when status == 'Lost'
    changed_by: Optional[str] = None  # operator making the change


class FinanceRequest(BaseModel):
    # Foreign side (in purchase_currency), converted to EGP via fx_to_egp.
    purchase_price: Optional[float] = None
    purchase_currency: Optional[str] = 'USD'
    fx_to_egp: Optional[float] = None       # EGP per 1 unit of purchase_currency
    shipping_cost: Optional[float] = None    # overseas freight (foreign currency)
    # Local side (already in EGP).
    customs_cost: Optional[float] = None
    clearance_cost: Optional[float] = None
    repair_cost: Optional[float] = None
    # Sale (in Egypt, EGP). payment_status is now DERIVED from payments, not set.
    sale_price_egp: Optional[float] = None
    buyer: Optional[str] = None
    buyer_id: Optional[int] = None
    sale_date: Optional[str] = None
    notes: Optional[str] = None


class BuyerRequest(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    notes: Optional[str] = None


class PaymentRequest(BaseModel):
    amount_egp: float
    paid_date: Optional[str] = None
    method: Optional[str] = None
    note: Optional[str] = None


class ExpenseRequest(BaseModel):
    expense_date: str
    category: str
    amount_egp: float
    note: Optional[str] = None


class UserRequest(BaseModel):
    name: str
    role: str = "Operator"
    password: Optional[str] = None
    commission_pct: Optional[float] = 0


class UserUpdateRequest(BaseModel):
    role: Optional[str] = None
    commission_pct: Optional[float] = None


class PasswordResetRequest(BaseModel):
    password: str


class ManualListingRequest(BaseModel):
    make: str
    model: str
    year: Optional[int] = None
    hours: Optional[int] = None
    price: Optional[str] = None
    location: Optional[str] = None
    country: Optional[str] = None
    currency: Optional[str] = None
    category: Optional[str] = None
    seller_name: Optional[str] = None
    seller_phone: Optional[str] = None
    seller_email: Optional[str] = None
    seller_company: Optional[str] = None
    notes: Optional[str] = None
    initial_status: Optional[str] = None


class PushListingRequest(BaseModel):
    id: str
    url: str
    make: str
    model: str
    year: Optional[int] = None
    hours: Optional[int] = None
    price: Optional[str] = None
    location: Optional[str] = None
    source: str
    listing_date: Optional[str] = None
    category: Optional[str] = None
    country: Optional[str] = None
    currency: Optional[str] = None


@app.post("/api/listings/push", dependencies=[Depends(require_api_key)])
def push_listing(item: PushListingRequest):
    """Receive a listing from a local harvester and save to DB."""
    try:
        listing_dict = item.dict()
        new_count = save_listings([listing_dict])

        if new_count > 0:
            # Assign to a single operator via round-robin, matching main.py.
            chat_ids = get_active_chat_ids()
            target_chat_id = get_next_assignee(chat_ids)
            if target_chat_id:
                TelegramNotifier().send_alert(listing_dict, target_chat_id)
            return {"status": "success", "message": "Listing saved and notified"}
        else:
            return {"status": "success", "message": "Listing already exists"}
    except Exception as e:
        logger.error(f"Error pushing listing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/listings", dependencies=[Depends(require_login)])
def get_listings():
    try:
        conn = _db()
        cursor = conn.cursor()

        # Return every non-junk row (all pipeline stages incl. Lost/Sold) so the
        # dashboard can compute close rates; views filter stages client-side.
        cursor.execute("SELECT * FROM listings WHERE status != 'Removed' ORDER BY discovered_at DESC")
        rows = cursor.fetchall()

        listings = []
        for row in rows:
            row_dict = dict(row)
            loc_str = row_dict.get("location") or "Unknown"

            # Prefer stored coordinates; geocode legacy/unresolved rows and persist.
            # On a transient geocode failure (None) leave the row NULL so the next
            # poll retries instead of freezing a bad value.
            lat = row_dict.get("lat")
            lng = row_dict.get("lng")
            if lat is None or lng is None:
                coords = get_lat_lng(loc_str)
                if coords is not None:
                    lat, lng = coords
                    cursor.execute("UPDATE listings SET lat = ?, lng = ? WHERE id = ?",
                                   (lat, lng, row_dict.get("id")))

            listings.append({
                "listing_id": row_dict.get("id"),
                "source": row_dict.get("source"),
                "make": row_dict.get("make"),
                "model": row_dict.get("model"),
                "year": row_dict.get("year"),
                "hours": row_dict.get("hours"),
                "price": row_dict.get("price"),
                "location": loc_str,
                "category": row_dict.get("category"),
                "country": row_dict.get("country"),
                "currency": row_dict.get("currency"),
                "url": row_dict.get("url"),
                "timestamp": row_dict.get("discovered_at"),
                "claimed_by": row_dict.get("claimed_by", None),
                "status": row_dict.get("status") or (row_dict.get("claimed_by") and "Claimed") or "Active",
                "lost_reason": row_dict.get("lost_reason"),
                "status_changed_at": row_dict.get("status_changed_at"),
                "lat": lat,
                "lng": lng
            })
        conn.commit()
        conn.close()
        return {"listings": listings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/listings/{listing_id}/detail", dependencies=[Depends(require_login)])
def listing_detail(listing_id: str):
    """Full mirrored detail for one listing: core fields + seller contact +
    web paths of the locally mirrored photos. Powers the Sourcing detail view so
    staff never need to open the (geo-blocked) source site."""
    conn = _db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM listings WHERE id = ?", (listing_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    core = dict(row)
    detail = get_listing_detail(listing_id) or {}
    return {
        "listing_id": core.get("id"),
        "source": core.get("source"),
        "make": core.get("make"),
        "model": core.get("model"),
        "year": core.get("year"),
        "hours": core.get("hours"),
        "price": core.get("price"),
        "location": core.get("location"),
        "category": core.get("category"),
        "country": core.get("country"),
        "currency": core.get("currency"),
        "url": core.get("url"),
        "status": core.get("status") or (core.get("claimed_by") and "Claimed") or "Active",
        "claimed_by": core.get("claimed_by"),
        "images": detail.get("images", []),
        "seller_name": detail.get("seller_name"),
        "seller_phone": detail.get("seller_phone"),
        "seller_email": detail.get("seller_email"),
        "seller_company": detail.get("seller_company"),
        "seller_website": detail.get("seller_website"),
        "seller_address": detail.get("seller_address"),
        "description": detail.get("description"),
    }


@app.get("/media/{rel_path:path}")
def serve_media(rel_path: str, t: Optional[str] = None,
                authorization: Optional[str] = Header(None)):
    """Mirrored listing photos. Requires a login session; <img> tags can't send
    an Authorization header, so the token is also accepted as ?t=<token>."""
    user = get_session_user(_bearer_token(authorization)) or get_session_user(t)
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    root = os.path.realpath(MEDIA_ROOT)
    full = os.path.realpath(os.path.join(root, rel_path))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(full)


@app.post("/listings/{listing_id}/status", dependencies=[Depends(require_login)])
def change_status(listing_id: str, payload: StatusRequest):
    """Move a deal through the pipeline. 'Lost' requires a reason; every change
    is appended to status_history for funnel/close-rate reporting."""
    if payload.status not in PIPELINE_STATUSES:
        raise HTTPException(status_code=400,
                            detail=f"Unknown status. Allowed: {', '.join(PIPELINE_STATUSES)}")
    if payload.status == 'Lost' and not (payload.reason or '').strip():
        raise HTTPException(status_code=400, detail="A reason is required when marking a deal Lost")
    try:
        changed = set_listing_status(listing_id, payload.status,
                                     reason=payload.reason, changed_by=payload.changed_by)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not changed:
        raise HTTPException(status_code=404, detail="Listing not found")
    return {"success": True, "message": f"Status set to {payload.status}"}


@app.post("/claim", dependencies=[Depends(require_login)])
def claim_listing(claim: ClaimRequest):
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE listings SET claimed_by = ? WHERE id = ?",
                       (claim.employee_name, claim.listing_id))
        conn.commit()
        found = cursor.rowcount > 0
        conn.close()

        if not found:
            raise HTTPException(status_code=404, detail="Listing not found")

        # Status + history in one place so the funnel sees the claim event.
        set_listing_status(claim.listing_id, 'Claimed', changed_by=claim.employee_name)
        return {"success": True, "message": f"Listing claimed by {claim.employee_name}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/listings/{listing_id}/complete", dependencies=[Depends(require_login)])
def complete_listing(listing_id: str):
    """Legacy endpoint (old 'Mark as Purchased' button) — now maps to the
    'Purchased' pipeline stage."""
    try:
        set_listing_status(listing_id, 'Purchased')
        return {"message": "Listing marked as Purchased"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/listings/{listing_id}/remove", dependencies=[Depends(require_login)])
def remove_listing(listing_id: str, payload: RemoveRequest):
    try:
        set_listing_status(listing_id, 'Removed', reason=payload.reason)
        return {"message": "Listing removed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/listings/manual", dependencies=[Depends(require_login)])
def create_manual(payload: ManualListingRequest):
    """Add a deal heard by phone/email (not scraped). It then flows through the
    same pipeline, finance and profit tracking as a scraped listing."""
    if not payload.make.strip() or not payload.model.strip():
        raise HTTPException(status_code=400, detail="Make and model are required")
    try:
        lid = create_manual_listing(payload.dict())
        # Optional starting stage beyond the default 'Active'.
        if payload.initial_status and payload.initial_status in PIPELINE_STATUSES and payload.initial_status != 'Active':
            set_listing_status(lid, payload.initial_status)
        return {"success": True, "id": lid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/activity", dependencies=[Depends(require_manager)])
def activity_feed():
    """Recent deal + payment activity for the manager Overview. MANAGER ONLY."""
    return {"activity": get_recent_activity(15)}


@app.get("/backup/download", dependencies=[Depends(require_manager)])
def backup_download():
    """One-click manager backup: a fresh, integrity-checked copy of the whole
    database, streamed to the manager's device. MANAGER ONLY. This is on-demand
    and complements (does not replace) the automatic nightly backup."""
    from backup_db import create_hot_backup
    stamp = __import__('datetime').datetime.now().strftime('%Y%m%d-%H%M%S')
    tmp = os.path.join(DOCS_ROOT, f'_backup_{uuid.uuid4().hex}.db')
    try:
        create_hot_backup(tmp)
    except Exception as e:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")
    # BackgroundTask deletes the temp copy after it's been streamed out.
    from starlette.background import BackgroundTask
    return FileResponse(
        tmp, filename=f'machinery-backup-{stamp}.db',
        media_type='application/octet-stream',
        background=BackgroundTask(lambda: os.path.exists(tmp) and os.remove(tmp)),
    )


@app.get("/finance", dependencies=[Depends(require_manager)])
def finance_list():
    """All owned machines (Purchased+) with finance + computed EGP profit.
    MANAGER ONLY — this is the money data operators must not see."""
    try:
        return {"deals": get_owned_deals()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/listings/{listing_id}/finance", dependencies=[Depends(require_manager)])
def finance_get(listing_id: str):
    fin = get_deal_finance(listing_id) or {}
    return {"finance": fin, "computed": compute_finance(fin)}


@app.post("/listings/{listing_id}/finance", dependencies=[Depends(require_manager)])
def finance_save(listing_id: str, payload: FinanceRequest):
    """Upsert a machine's costs + sale. MANAGER ONLY."""
    conn = _db()
    exists = conn.execute("SELECT 1 FROM listings WHERE id = ?", (listing_id,)).fetchone()
    conn.close()
    if not exists:
        raise HTTPException(status_code=404, detail="Listing not found")
    try:
        data = payload.dict()
        save_deal_finance(listing_id, data)
        return {"success": True, "computed": compute_finance(data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---- Buyers (mini-CRM) — manager only ----
@app.get("/buyers", dependencies=[Depends(require_manager)])
def buyers_list():
    return {"buyers": list_buyers()}


@app.post("/buyers", dependencies=[Depends(require_manager)])
def buyers_add(payload: BuyerRequest):
    return {"success": True, "id": add_buyer(payload.dict())}


@app.put("/buyers/{buyer_id}", dependencies=[Depends(require_manager)])
def buyers_update(buyer_id: int, payload: BuyerRequest):
    if not update_buyer(buyer_id, payload.dict()):
        raise HTTPException(status_code=404, detail="Buyer not found")
    return {"success": True}


# ---- Payments / installments — manager only ----
@app.get("/listings/{listing_id}/payments", dependencies=[Depends(require_manager)])
def payments_list(listing_id: str):
    return {"payments": list_payments(listing_id)}


@app.post("/listings/{listing_id}/payments", dependencies=[Depends(require_manager)])
def payments_add(listing_id: str, payload: PaymentRequest):
    return {"success": True, "id": add_payment(listing_id, payload.dict())}


@app.delete("/payments/{payment_id}", dependencies=[Depends(require_manager)])
def payments_delete(payment_id: int):
    delete_payment(payment_id)
    return {"success": True}


# ---- Company expenses — manager only ----
@app.get("/expenses", dependencies=[Depends(require_manager)])
def expenses_list():
    return {"expenses": list_expenses()}


@app.post("/expenses", dependencies=[Depends(require_manager)])
def expenses_add(payload: ExpenseRequest):
    return {"success": True, "id": add_expense(payload.dict())}


@app.delete("/expenses/{expense_id}", dependencies=[Depends(require_manager)])
def expenses_delete(expense_id: int):
    delete_expense(expense_id)
    return {"success": True}


# ---- Documents per machine (any logged-in user) ----
@app.get("/listings/{listing_id}/documents", dependencies=[Depends(require_login)])
def documents_list(listing_id: str):
    return {"documents": list_documents(listing_id)}


@app.post("/listings/{listing_id}/documents")
def documents_upload(listing_id: str, file: UploadFile = File(...),
                     doc_type: str = Form("Other"), user: dict = Depends(require_login)):
    # Sanitize + store under a random name so uploads can't collide or traverse.
    safe = re.sub(r'[^A-Za-z0-9._-]', '_', os.path.basename(file.filename or 'file'))[:120]
    stored = f"{uuid.uuid4().hex}_{safe}"
    dest_dir = os.path.join(DOCS_ROOT, listing_id)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, stored)
    size = 0
    with open(dest, 'wb') as out:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_DOC_BYTES:
                out.close(); os.remove(dest)
                raise HTTPException(status_code=413, detail="File too large (max 25 MB)")
            out.write(chunk)
    doc_id = add_document(listing_id, stored, safe, doc_type,
                          file.content_type, size, user.get('name'))
    return {"success": True, "id": doc_id}


@app.get("/documents/{document_id}/download", dependencies=[Depends(require_login)])
def documents_download(document_id: int):
    doc = get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = os.path.join(DOCS_ROOT, doc['listing_id'], doc['stored_name'])
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(path, filename=doc['original_name'],
                        media_type=doc.get('content_type') or 'application/octet-stream')


@app.delete("/documents/{document_id}", dependencies=[Depends(require_login)])
def documents_delete(document_id: int):
    doc = delete_document(document_id)
    if doc:
        path = os.path.join(DOCS_ROOT, doc['listing_id'], doc['stored_name'])
        if os.path.exists(path):
            os.remove(path)
    return {"success": True}


@app.get("/users", dependencies=[Depends(require_login)])
def get_users():
    """List users. NEVER returns password_hash/password_salt — those must not
    leave the server. Requires login (leaks names + chat ids otherwise)."""
    try:
        conn = _db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users")
        rows = cursor.fetchall()
        safe = {'password_hash', 'password_salt'}
        users = [{k: v for k, v in dict(row).items() if k not in safe} for row in rows]
        conn.close()
        return {"users": users}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/users", dependencies=[Depends(require_manager)])
def add_user(user: UserRequest):
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO users (name, role, commission_pct) VALUES (?, ?, ?)",
                       (user.name, user.role, user.commission_pct or 0))
        conn.commit()
        conn.close()
        # Set the login password if one was provided at creation.
        if user.password:
            set_user_password(user.name, user.password)
        return {"message": "User added"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Guard against the lockout that actually happened (2026-07-09): the last
# manager was demoted to Operator, leaving NOBODY able to reach Admin/Finance
# or undo the change. Demoting/deleting the final manager is refused here —
# server-side, so no UI bug can bypass it.
def _is_last_manager(user_id):
    conn = get_connection()
    cursor = conn.cursor()
    row = cursor.execute("SELECT LOWER(role) FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or row[0] != 'manager':
        conn.close()
        return False
    managers = cursor.execute("SELECT COUNT(*) FROM users WHERE LOWER(role) = 'manager'").fetchone()[0]
    conn.close()
    return managers <= 1


@app.put("/users/{user_id}", dependencies=[Depends(require_manager)])
def edit_user(user_id: int, payload: UserUpdateRequest):
    if payload.role and payload.role.lower() != 'manager' and _is_last_manager(user_id):
        raise HTTPException(status_code=400,
                            detail="Cannot demote the only manager — promote someone else first.")
    update_user_admin(user_id, role=payload.role, commission_pct=payload.commission_pct)
    return {"success": True}


@app.post("/users/{user_id}/reset-password", dependencies=[Depends(require_manager)])
def reset_user_password(user_id: int, payload: PasswordResetRequest):
    if len(payload.password or '') < 4:
        raise HTTPException(status_code=400, detail="Password too short")
    if not set_password_by_id(user_id, payload.password):
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@app.delete("/users/{user_id}", dependencies=[Depends(require_manager)])
def delete_user(user_id: int):
    if _is_last_manager(user_id):
        raise HTTPException(status_code=400,
                            detail="Cannot delete the only manager — promote someone else first.")
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()
        return {"message": "User deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
