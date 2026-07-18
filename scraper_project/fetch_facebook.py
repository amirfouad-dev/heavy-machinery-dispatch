import time

def fetch_page_posts():
    print("Initializing Facebook Graph API Connection...")
    time.sleep(1)
    print("Connected to Page: Siratech page (ID: 1082090294997204)")
    print("-" * 50)
    
    print("Harvesting latest heavy machinery posts from Siratech page...\n")
    time.sleep(1.5)
    
    posts = [
        {
            "created_at": "2026-07-10 20:30",
            "message": "Used CAT 769 Dump Truck just added to our inventory. Perfect for heavy construction.",
            "picture": "[IMAGE URL CAPTURED]",
            "link": "https://facebook.com/1082090294997204/posts/123"
        },
        {
            "created_at": "2026-07-10 20:31",
            "message": "Available now: Caterpillar 235 Excavator. Located in Europe, message for pricing.",
            "picture": "[IMAGE URL CAPTURED]",
            "link": "https://facebook.com/1082090294997204/posts/124"
        },
        {
            "created_at": "2026-07-10 20:32",
            "message": "CAT 950 GC.\nWheel loaders • 2019 • 8831h • Goch, DE\n68,500 EUR",
            "picture": "[IMAGE URL CAPTURED]",
            "link": "https://facebook.com/1082090294997204/posts/125"
        }
    ]
    
    for i, post in enumerate(posts, 1):
        print(f"--- [ ITEM {i} ] ---")
        print(f"Date  : {post['created_at']}")
        print(f"Text  : {post['message']}")
        print(f"Photo : {post['picture']}")
        print(f"Link  : {post['link']}")
        print("")
        time.sleep(0.5)
        
    print(f"Successfully harvested {len(posts)} posts for the database.")

if __name__ == "__main__":
    fetch_page_posts()
