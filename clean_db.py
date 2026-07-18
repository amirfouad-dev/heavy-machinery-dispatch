import sqlite3
import os

DB_PATH = '/opt/heavy-machinery/scraper_project/db/machinery.db'
if os.path.exists(DB_PATH):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM listings WHERE location = 'Texas, USA'")
    conn.commit()
    print(f"Deleted {cursor.rowcount} rows with location 'Texas, USA'")
    conn.close()
else:
    print("Database not found")
