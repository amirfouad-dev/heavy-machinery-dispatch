import sqlite3
import os
import sys

# Add scrapers to path to import utils
sys.path.append(os.path.join(os.path.dirname(__file__), 'scrapers'))
from utils import is_allowed_model

db_path = os.path.join(os.path.dirname(__file__), 'db', 'machinery.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

cursor.execute("SELECT id, make, model FROM listings")
rows = cursor.fetchall()

deleted_count = 0
for row in rows:
    if not is_allowed_model(row['make'], row['model']):
        cursor.execute("DELETE FROM listings WHERE id = ?", (row['id'],))
        deleted_count += 1

conn.commit()
conn.close()

print(f"Deleted {deleted_count} unauthorized listings.")
