from .base_scraper import BaseScraper
import uuid

class ExampleScraper(BaseScraper):
    def __init__(self):
        super().__init__(source_name="Example_Company_Site")

    def parse_listing(self, element):
        # In a real scenario, 'element' would be a BeautifulSoup node
        pass

    def scrape(self, search_urls):
        """
        Dummy implementation. In reality, you'd fetch the URL and parse HTML.
        """
        # Simulated list of found machines
        dummy_data = [
            {
                'id': f'ex_{uuid.uuid4().hex[:8]}', # Unique ID from the site
                'url': 'https://example.com/listing/cat-980h-123',
                'make': 'CAT',
                'model': '980H',
                'year': 2011,
                'hours': 14500,
                'price': '$95,000',
                'location': 'Germany',
                'source': self.source_name
            },
            {
                'id': f'ex_{uuid.uuid4().hex[:8]}',
                'url': 'https://example.com/listing/doosan-dx300lc-456',
                'make': 'Doosan',
                'model': 'DX300LC',
                'year': 2018,
                'hours': 6200,
                'price': '€110,000',
                'location': 'France',
                'source': self.source_name
            }
        ]
        
        for item in dummy_data:
            yield item
