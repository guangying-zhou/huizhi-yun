import asyncio
import json
import logging
import os
import signal
import subprocess
import time
from typing import List, Dict, Any
from pathlib import Path
from scrapling.fetchers import StealthyFetcher
from app.runtime_client import runtime_client

logger = logging.getLogger(__name__)


def _get_chrome_pids_for_session(session_dir: str = "./x-session") -> List[int]:
    """Find Chrome process PIDs that use our session directory."""
    pids = []
    abs_session = str(Path(session_dir).absolute())
    try:
        result = subprocess.run(
            ["pgrep", "-f", f"user-data-dir={abs_session}"],
            capture_output=True, text=True, timeout=5
        )
        if result.stdout.strip():
            for line in result.stdout.strip().split("\n"):
                try:
                    pids.append(int(line.strip()))
                except ValueError:
                    pass
    except FileNotFoundError:
        logger.warning("pgrep not found, cannot detect Chrome processes")
    except subprocess.TimeoutExpired:
        logger.warning("pgrep timed out, system may be under heavy load")
    except Exception as e:
        logger.warning(f"Failed to find Chrome PIDs: {e}")
    return pids


def cleanup_chrome_processes(session_dir: str = "./x-session"):
    """Kill any orphaned Chrome processes belonging to our session."""
    pids = _get_chrome_pids_for_session(session_dir)
    if not pids:
        return
    logger.info(f"Cleaning up {len(pids)} orphaned Chrome processes: {pids}")
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except Exception as e:
            logger.warning(f"Failed to kill Chrome PID {pid}: {e}")
    # Give processes time to exit gracefully, then force kill survivors
    time.sleep(2)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except Exception:
            pass

class XBookmarkScraper:
    def __init__(self):
        self.session_dir = "./x-session"
        self.bookmarks_data = []

    def _handle_response_sync(self, response):
        """Synchronous version: Intercept GraphQL responses from X API."""
        if "graphql" in response.url and "Bookmarks" in response.url:
            try:
                # Synchronous response.json()
                data = response.json()
                logger.info(f"Intercepted Bookmarks GraphQL response from {response.url}")
                
                # Save raw response for debugging (first response only)
                if not self.bookmarks_data:
                    try:
                        with open("raw_response.json", "w", encoding="utf-8") as f:
                            json.dump(data, f, indent=2, ensure_ascii=False)
                        logger.info("Saved raw GraphQL response to raw_response.json for debugging")
                    except Exception as e:
                        logger.warning(f"Failed to save raw response: {e}")
                
                self._parse_graphql_data(data)
            except Exception as e:
                logger.error(f"Error parsing intercepted response: {e}")

    async def _handle_response(self, response):
        """Async version: Intercept GraphQL responses from X API."""
        if "graphql" in response.url and "Bookmarks" in response.url:
            try:
                # Need to read the body. Note: Playwright async response.json()
                data = await response.json()
                logger.info(f"Intercepted Bookmarks GraphQL response from {response.url}")
                
                # Save raw response for debugging (first response only)
                if not self.bookmarks_data:
                    try:
                        with open("raw_response.json", "w", encoding="utf-8") as f:
                            json.dump(data, f, indent=2, ensure_ascii=False)
                        logger.info("Saved raw GraphQL response to raw_response.json for debugging")
                    except Exception as e:
                        logger.warning(f"Failed to save raw response: {e}")
                
                self._parse_graphql_data(data)
            except Exception as e:
                logger.error(f"Error parsing intercepted response: {e}")

    def _parse_graphql_data(self, data: Dict[str, Any]):
        """Extract tweets from the GraphQL response."""
        try:
            instructions = data.get("data", {}).get("bookmark_timeline_v2", {}).get("timeline", {}).get("instructions", [])
            for inst in instructions:
                if inst.get("type") == "TimelineAddEntries":
                    for entry in inst.get("entries", []):
                        content = entry.get("content", {})
                        if content.get("entryType") == "TimelineTimelineItem":
                            item_result = content.get("itemContent", {}).get("tweet_results", {}).get("result", {})
                            
                            # Handle retweet/quote structure
                            if item_result.get("__typename") == "TweetWithVisibilityResults":
                                item_result = item_result.get("tweet", {})
                                
                            legacy = item_result.get("legacy", {})
                            core = item_result.get("core", {}).get("user_results", {}).get("result", {})
                            
                            tweet_id = legacy.get("id_str")
                            if not tweet_id:
                                continue
                                
                            full_text = legacy.get("full_text", "")
                            
                            # Extract long tweet (Note) text if present
                            note_tweet = item_result.get("note_tweet", {}).get("note_tweet_results", {}).get("result", {})
                            if note_tweet and note_tweet.get("text"):
                                full_text = note_tweet.get("text")

                            # Extract media (images/videos)
                            media_list = []
                            entities = legacy.get("extended_entities", {}) or legacy.get("entities", {})
                            for media_item in entities.get("media", []):
                                if media_item.get("type") == "photo":
                                    media_url = media_item.get("media_url_https")
                                    if media_url:
                                        media_list.append(media_url)
                                elif media_item.get("type") in ["video", "animated_gif"]:
                                    # Fallback to thumbnail for videos
                                    media_url = media_item.get("media_url_https")
                                    if media_url:
                                        media_list.append(media_url)
                                        
                            # Build a comprehensive markdown representation for the raw content
                            full_content = full_text
                            if media_list:
                                full_content += "\n\n"
                                for m_url in media_list:
                                    full_content += f"![image]({m_url})\n"
                            
                            # Try multiple paths to get author handle
                            author_handle = "unknown"
                            # Note: `core` (line 54) already = item_result.core.user_results.result
                            
                            # Method 1: New API structure - screen_name in user_result.core
                            user_core = core.get("core", {})
                            if user_core.get("screen_name"):
                                author_handle = user_core["screen_name"]
                            # Method 2: Old API structure - screen_name in user_result.legacy
                            elif core.get("legacy", {}).get("screen_name"):
                                author_handle = core["legacy"]["screen_name"]
                            else:
                                logger.warning(f"Could not extract author for tweet {tweet_id}")
                                
                            urls = legacy.get("entities", {}).get("urls", [])
                            external_url = ""
                            if urls:
                                external_url = urls[0].get("expanded_url", "")

                            has_external_link = bool(external_url)

                            # Extract article/card title from GraphQL response
                            article_title = ""
                            cover_image = ""
                            # Path 1: X native article (article.article_results.result.title)
                            article_data = item_result.get("article", {})
                            native_article = article_data.get("article_results", {}).get("result", {})
                            article_title = native_article.get("title", "")
                            
                            media_info = native_article.get("cover_media", {}).get("media_info", {})
                            if media_info:
                                cover_image = media_info.get("original_img_url", "")

                            # Path 2: quoted tweet's article
                            if not article_title:
                                quoted = item_result.get("quoted_status_result", {}).get("result", {})
                                quoted_article = quoted.get("article", {}).get("article_results", {}).get("result", {})
                                article_title = quoted_article.get("title", "")
                                if not cover_image:
                                    q_media_info = quoted_article.get("cover_media", {}).get("media_info", {})
                                    if q_media_info:
                                        cover_image = q_media_info.get("original_img_url", "")

                            # Path 3: card binding_values (external link cards)
                            card = item_result.get("card", {})
                            binding_values = card.get("legacy", {}).get("binding_values", [])
                            if binding_values:
                                for bv in binding_values:
                                    if not article_title and bv.get("key") == "title":
                                        article_title = bv.get("value", {}).get("string_value", "")
                                    if not cover_image and bv.get("key") == "thumbnail_image_large":
                                        cover_image = bv.get("value", {}).get("image_value", {}).get("url", "")
                                    # Extract card URL as external link when entities.urls is empty
                                    if not external_url and bv.get("key") == "card_url":
                                        external_url = bv.get("value", {}).get("string_value", "")
                                    if not external_url and bv.get("key") == "url":
                                        external_url = bv.get("value", {}).get("string_value", "")
                                # Update has_external_link if we found a card URL
                                if external_url and not has_external_link:
                                    has_external_link = True

                            # Build source URL
                            if has_external_link:
                                source_url = external_url
                            else:
                                if author_handle != "unknown":
                                    source_url = f"https://x.com/{author_handle}/status/{tweet_id}"
                                else:
                                    source_url = f"https://x.com/i/status/{tweet_id}"

                            logger.info(f"Parsed bookmark: id={tweet_id}, author={author_handle}, has_external={has_external_link}, title={article_title[:50] if article_title else '(none)'}")

                            self.bookmarks_data.append({
                                "id": tweet_id,
                                "author_handle": author_handle,
                                "content_snippet": full_text[:500],
                                "full_content": full_content,
                                "source_url": source_url,
                                "has_external_link": has_external_link,
                                "article_title": article_title,
                                "cover_image": cover_image
                            })
        except Exception as e:
            logger.error(f"Failed to parse target GraphQL data: {e}")

    def _page_action_sync(self, page):
        """Synchronous version of page action for StealthyFetcher"""
        page.on("response", self._handle_response_sync)
        
        # Check if login is needed
        try:
            page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
            
        if "login" in page.url or "i/flow/login" in page.url:
            logger.info("Need to login to X. Please login manually in the open browser window.")
            # Wait until user logs in and gets redirected to home or bookmarks
            page.wait_for_url("**/i/bookmarks**", timeout=0)  # Wait indefinitely for manual login
            logger.info("Login successful. Continuing to scrape...")
        
        # Scroll down a few times to load bookmarks
        logger.info("Scrolling to load bookmarks...")
        for _ in range(5):
            try:
                page.evaluate("window.scrollTo(0, document.body ? document.body.scrollHeight : (document.documentElement ? document.documentElement.scrollHeight : 0))")
            except Exception as e:
                logger.warning(f"Failed to scroll page: {e}")
            page.wait_for_timeout(3000)
            
        logger.info(f"Loaded {len(self.bookmarks_data)} bookmarks from API.")

    async def _page_action(self, page):
        """Playwright page action to scroll and trigger API requests."""
        page.on("response", self._handle_response)
        
        # Check if login is needed
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
            
        if "login" in page.url or "i/flow/login" in page.url:
            logger.info("Need to login to X. Please login manually in the open browser window.")
            # Wait until user logs in and gets redirected to home or bookmarks
            await page.wait_for_url("**/i/bookmarks**", timeout=0)  # Wait indefinitely for manual login
            logger.info("Login successful. Continuing to scrape...")
        
        # Scroll down a few times to load bookmarks
        logger.info("Scrolling to load bookmarks...")
        for _ in range(5):
            try:
                await page.evaluate("window.scrollTo(0, document.body ? document.body.scrollHeight : (document.documentElement ? document.documentElement.scrollHeight : 0))")
            except Exception as e:
                logger.warning(f"Failed to scroll page: {e}")
            await page.wait_for_timeout(3000)
            
        logger.info(f"Loaded {len(self.bookmarks_data)} bookmarks from API.")

    def _load_cookies(self) -> List[Dict[str, Any]]:
        """Load cookies from cookies.json or playwright_state.json."""
        # Try playwright_state.json first, then cookies.json
        for cookies_path in [Path("playwright_state.json"), Path("cookies.json")]:
            if cookies_path.exists():
                try:
                    with open(cookies_path, 'r') as f:
                        data = json.load(f)
                    cookies = data.get('cookies', [])
                    if cookies:
                        # Ensure sameSite values are properly capitalized for Playwright
                        for cookie in cookies:
                            same_site = cookie.get('sameSite', 'None')
                            if same_site:
                                cookie['sameSite'] = same_site.capitalize() if same_site.lower() in ('lax', 'strict', 'none') else 'None'
                            # Remove expires if it's -1 or 0 (session cookie)
                            expires = cookie.get('expires', -1)
                            if expires and expires <= 0:
                                cookie.pop('expires', None)
                        logger.info(f"Loaded {len(cookies)} cookies from {cookies_path}")
                        return cookies
                except Exception as e:
                    logger.error(f"Failed to load cookies from {cookies_path}: {e}")
        return []

    async def fetch_new_bookmarks(self) -> List[Dict[str, Any]]:
        """Fetch bookmarks from X and save to the database."""
        self.bookmarks_data = [] # Reset

        # Load cookies for authentication
        cookies = self._load_cookies()

        if cookies:
            logger.info(f"Using {len(cookies)} cookies for authentication")
            # Check for required auth cookies
            cookie_names = {c['name'] for c in cookies}
            required = {'auth_token', 'ct0', 'twid'}
            missing = required - cookie_names
            if missing:
                logger.warning(f"Missing required cookies: {missing}")
        else:
            logger.warning("No cookies found, using user_data_dir for session")

        # Using StealthyFetcher to bypass anti-bot (scrapling 0.2.99+ API)
        logger.info("Starting Scrapling stealthy fetch...")

        # Record Chrome PIDs before fetch to detect new ones
        pids_before = set(_get_chrome_pids_for_session(self.session_dir))

        # StealthyFetcher.fetch() is synchronous, so we need to run it in a thread
        def _sync_fetch():
            # Prepare fetch parameters
            fetch_params = {
                "page_action": self._page_action_sync,  # Use sync version
                "headless": True,
                "timeout": 300000,
                "load_dom": True,
                "wait": 5000
            }

            # Use cookies if available, otherwise use user_data_dir
            if cookies:
                fetch_params["cookies"] = cookies
            else:
                fetch_params["user_data_dir"] = self.session_dir

            StealthyFetcher.fetch(
                "https://x.com/i/bookmarks",
                **fetch_params
            )

        try:
            # Run the synchronous fetch in a thread pool
            await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Scrapling fetch failed: {e}")
        finally:
            # Always clean up Chrome processes spawned during this fetch
            pids_after = set(_get_chrome_pids_for_session(self.session_dir))
            new_pids = pids_after - pids_before
            if new_pids:
                logger.info(f"Cleaning up {len(new_pids)} Chrome processes from this fetch")
                for pid in new_pids:
                    try:
                        os.kill(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    except Exception as e:
                        logger.warning(f"Failed to kill Chrome PID {pid}: {e}")

        return self.bookmarks_data

def save_bookmarks_to_runtime(bookmarks: List[Dict[str, Any]]):
    """Save newly fetched bookmarks through tenant-runtime."""
    if not bookmarks:
        logger.info("No bookmarks to save.")
        return

    try:
        result = runtime_client.import_bookmarks(bookmarks)
        logger.info(
            "Successfully imported bookmarks through tenant-runtime: "
            f"inserted={result.get('inserted', 0)}, "
            f"updated={result.get('updated', 0)}, "
            f"skipped={result.get('skipped', 0)}"
        )
    except Exception as e:
        logger.error(f"Runtime error while saving bookmarks: {e}")

if __name__ == "__main__":
    # Test script
    logging.basicConfig(level=logging.INFO)
    scraper = XBookmarkScraper()
    bookmarks = asyncio.run(scraper.fetch_new_bookmarks())
    
    # Needs tenant-runtime running to test save
    # save_bookmarks_to_runtime(bookmarks)
    logger.info(f"Test completed. Fetched {len(bookmarks)} items.")
