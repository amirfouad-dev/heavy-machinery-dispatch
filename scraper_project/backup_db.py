"""Nightly database backup (run by cron on the VPS).

WAL-safe hot backup via sqlite3's online backup API (safe while the API/scraper
are writing), integrity-checked, gzipped, rotated to the last N days. Paired with
an off-site pull to the owner's PC (see pull_backup.ps1) so a dead VPS disk never
means a dead business.
"""
import os
import sys
import glob
import gzip
import shutil
import sqlite3
from datetime import datetime

DB = os.path.join(os.path.dirname(__file__), 'db', 'machinery.db')
DEST = os.environ.get('BACKUP_DIR', '/opt/heavy-machinery/backups')
KEEP = int(os.environ.get('BACKUP_KEEP', '30'))


def _cleanup_raw(raw):
    """Remove the uncompressed snapshot and its WAL/SHM sidecars, if present."""
    for path in (raw, raw + '-wal', raw + '-shm'):
        if os.path.exists(path):
            os.remove(path)


def create_hot_backup(dest_path):
    """WAL-safe online backup of the live DB to dest_path, integrity-checked.
    Raises RuntimeError if the snapshot is corrupt. Used by the nightly job AND
    the manager's one-click "Download backup" button."""
    src = sqlite3.connect(DB)
    dst = sqlite3.connect(dest_path)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()
    chk = sqlite3.connect(dest_path)
    try:
        result = chk.execute('PRAGMA integrity_check').fetchone()[0]
    finally:
        chk.close()
    if result != 'ok':
        _cleanup_raw(dest_path)
        raise RuntimeError(f'integrity check failed: {result}')
    return dest_path


def main():
    os.makedirs(DEST, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    raw = os.path.join(DEST, f'machinery-{stamp}.db')

    # Online backup — consistent snapshot even with WAL + concurrent writers.
    src = sqlite3.connect(DB)
    dst = sqlite3.connect(raw)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()

    # Verify the snapshot is not corrupt before trusting/rotating.
    chk = sqlite3.connect(raw)
    try:
        check = chk.execute('PRAGMA integrity_check').fetchone()[0]
    finally:
        chk.close()
    if check != 'ok':
        _cleanup_raw(raw)
        print(f'{datetime.now()} INTEGRITY CHECK FAILED: {check}', file=sys.stderr)
        sys.exit(1)

    with open(raw, 'rb') as f_in, gzip.open(raw + '.gz', 'wb') as f_out:
        shutil.copyfileobj(f_in, f_out)
    _cleanup_raw(raw)  # remove the uncompressed .db and any WAL/SHM sidecars

    # Rotate: keep the newest KEEP archives, delete the rest.
    archives = sorted(glob.glob(os.path.join(DEST, 'machinery-*.db.gz')), reverse=True)
    for old in archives[KEEP:]:
        os.remove(old)

    size = os.path.getsize(raw + '.gz')
    print(f'{datetime.now()} backup ok: {raw}.gz ({size} bytes), {len(archives[:KEEP])} kept')


if __name__ == '__main__':
    main()
