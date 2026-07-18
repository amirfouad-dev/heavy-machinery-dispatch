"""Shared geocoding helper.

Used at listing-insert time (db.database) so we geocode each location exactly
once instead of hammering Nominatim on every dashboard poll. The API layer reads
the stored lat/lng and only falls back to a live lookup for legacy rows.

Nominatim's usage policy allows ~1 request/second; keep calls infrequent.
"""
import logging
from geopy.geocoders import Nominatim

logger = logging.getLogger(__name__)

_geolocator = Nominatim(user_agent="machinery_dispatch_dashboard")
_cache = {}


def get_lat_lng(location_str):
    """Resolve a location string to coordinates.

    Returns:
        (lat, lng) when resolved — including (0.0, 0.0) for an empty/unknown
                   location or a genuine "no match" (these are final answers).
        None       on a transient failure (timeout, rate-limit, network error).
                   Callers should leave the stored coordinates NULL so a later
                   call retries, rather than freezing a bad value.

    Resolved results are cached in-process; failures are never cached.
    """
    if not location_str or str(location_str).strip().lower() in ("", "unknown"):
        return 0.0, 0.0

    if location_str in _cache:
        return _cache[location_str]

    try:
        location = _geolocator.geocode(location_str, timeout=3)
    except Exception as e:
        logger.warning(f"Geocode failed for '{location_str}': {e}")
        return None  # transient — signal retry, do not cache

    result = (location.latitude, location.longitude) if location else (0.0, 0.0)
    _cache[location_str] = result
    return result
