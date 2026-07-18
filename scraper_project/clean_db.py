import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'db', 'machinery.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Delete IronPlanet
cursor.execute("DELETE FROM listings WHERE source = 'IronPlanet'")
deleted_ip = cursor.rowcount

# Delete anything mentioning Auction in price
cursor.execute("DELETE FROM listings WHERE price LIKE '%Auction%' OR price LIKE '%auction%'")
deleted_auc = cursor.rowcount

conn.commit()
conn.close()

print(f"Deleted {deleted_ip} IronPlanet listings and {deleted_auc} other auction listings.")
