#!/usr/bin/env python3
"""
First time login script - Run this once to save X session
Usage: python first_login.py
"""

import asyncio
import logging
from app.scraper import XBookmarkScraper

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    logger.info("Starting first-time login process...")
    logger.info("A browser window will open. Please login to X manually.")
    logger.info("After login, the script will save your session for future use.")
    
    scraper = XBookmarkScraper()
    
    # Temporarily modify to non-headless for manual login
    from scrapling.fetchers import StealthyFetcher
    
    async def _login_action(page):
        logger.info("Browser opened. Waiting for you to login...")
        
        # Wait for page to load
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
        
        # Check if already logged in
        if "login" not in page.url and "i/flow/login" not in page.url:
            logger.info("✓ Already logged in!")
            return
        
        logger.info("Please login in the browser window...")
        logger.info("Waiting for login to complete (timeout: 5 minutes)...")
        
        # Wait for successful login (redirect to bookmarks or home)
        try:
            await page.wait_for_url("**/i/bookmarks**", timeout=300000)
            logger.info("✓ Login successful! Session saved.")
        except Exception as e:
            logger.error(f"Login timeout or failed: {e}")
            logger.info("Please try again.")
    
    try:
        await StealthyFetcher.fetch(
            "https://x.com/i/bookmarks",
            page_action=_login_action,
            headless=False,  # Non-headless for manual login
            user_data_dir=scraper.session_dir,
            timeout=360000,  # 6 minutes
            load_dom=True,
            wait=2000
        )
        
        logger.info("=" * 60)
        logger.info("✓ Session saved successfully!")
        logger.info("You can now run the service in headless mode.")
        logger.info("=" * 60)
        
    except Exception as e:
        logger.error(f"Error during login: {e}")
        logger.info("Please try again or check your network connection.")

if __name__ == "__main__":
    asyncio.run(main())
