import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

logger = logging.getLogger(__name__)

class EmailNotifier:
    def __init__(self):
        self.smtp_server = os.environ.get('SMTP_SERVER', 'smtp.gmail.com')
        self.smtp_port = int(os.environ.get('SMTP_PORT', 587))
        self.smtp_user = os.environ.get('SMTP_USER')
        self.smtp_password = os.environ.get('SMTP_PASSWORD')
        self.to_email = os.environ.get('TO_EMAIL')

    def send_daily_digest(self, listings):
        if not all([self.smtp_user, self.smtp_password, self.to_email]):
            logger.warning("Email credentials not fully configured. Skipping digest.")
            return False

        if not listings:
            logger.info("No listings to send in digest.")
            return True

        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"Daily Heavy Machinery Digest ({len(listings)} listings)"
        msg['From'] = self.smtp_user
        msg['To'] = self.to_email

        # Create HTML email content
        html = "<html><body><h2>Daily Heavy Machinery Digest</h2><ul>"
        for item in listings:
            html += f"<li><a href='{item.get('url')}'><b>{item.get('make')} {item.get('model')}</b></a> - "
            html += f"Year: {item.get('year', 'N/A')}, Hours: {item.get('hours', 'N/A')}, Price: {item.get('price', 'N/A')}, Location: {item.get('location', 'N/A')}</li>"
        html += "</ul></body></html>"

        msg.attach(MIMEText(html, 'html'))

        try:
            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.starttls()
            server.login(self.smtp_user, self.smtp_password)
            server.send_message(msg)
            server.quit()
            logger.info(f"Daily email digest sent with {len(listings)} listings.")
            return True
        except Exception as e:
            logger.error(f"Failed to send email digest: {e}")
            return False
