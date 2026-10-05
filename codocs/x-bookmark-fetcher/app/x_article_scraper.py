"""
X Article Scraper using authenticated session
"""
import asyncio
import json
import os
import re
import signal
from playwright.async_api import async_playwright
import logging
from pathlib import Path
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class XArticleScraper:
    def __init__(self, user_data_dir: str = "./x-session"):
        self.user_data_dir = Path(user_data_dir).absolute()

    def _load_cookies(self) -> List[Dict[str, Any]]:
        """Load cookies from cookies.json or playwright_state.json."""
        for cookies_path in [Path("playwright_state.json"), Path("cookies.json")]:
            if cookies_path.exists():
                try:
                    with open(cookies_path, 'r') as f:
                        data = json.load(f)
                    cookies = data.get('cookies', [])
                    if cookies:
                        for cookie in cookies:
                            same_site = cookie.get('sameSite', 'None')
                            if same_site:
                                cookie['sameSite'] = same_site.capitalize() if same_site.lower() in ('lax', 'strict', 'none') else 'None'
                            expires = cookie.get('expires', -1)
                            if expires and expires <= 0:
                                cookie.pop('expires', None)
                        logger.info(f"Loaded {len(cookies)} cookies from {cookies_path}")
                        return cookies
                except Exception as e:
                    logger.error(f"Failed to load cookies from {cookies_path}: {e}")
        return []

    async def fetch_article_content(self, article_url: str) -> tuple[str, str, str]:
        """
        Fetch X article content using authenticated stealthy session.
        Returns: (title, summary, markdown_content)
        """
        from scrapling.fetchers import StealthyFetcher

        content_html = ""
        title = "[no-title]"

        async def _page_action(page):
            nonlocal content_html, title

            try:
                await page.wait_for_load_state("domcontentloaded", timeout=45000)
                logger.info("Page loaded, waiting for content...")
                await page.wait_for_timeout(3000)

                page_text = await page.inner_text('body')

                # Check if we're on a visible error page
                if 'Something went wrong' in page_text or 'privacy related extensions' in page_text:
                    logger.warning("Detected X error page, session might be invalid or bot blocked")
                    content_html = ""
                    return

                # Scroll down to load all lazy-rendered article content.
                # Use "stable rounds" instead of one-time equality check,
                # because some blocks are appended with delayed network/render.
                logger.info("Scrolling to load full article content...")
                stable_rounds = 0
                max_scrolls = 80
                for _ in range(max_scrolls):
                    try:
                        cur_height = await page.evaluate("document.documentElement.scrollHeight")
                        await page.evaluate("window.scrollBy(0, Math.floor(window.innerHeight * 0.9))")
                        await page.wait_for_timeout(1200)
                        new_height = await page.evaluate("document.documentElement.scrollHeight")

                        if new_height <= cur_height:
                            stable_rounds += 1
                        else:
                            stable_rounds = 0

                        if stable_rounds >= 3:
                            break
                    except Exception:
                        break

                # Scroll back to top
                await page.evaluate("window.scrollTo(0, 0)")
                await page.wait_for_timeout(500)

                # Extract title
                try:
                    for selector in ['[data-testid="twitter-article-title"]', 'h1[dir="auto"]', '[role="heading"]']:
                        title_elem = await page.query_selector(selector)
                        if title_elem:
                            title_text = await title_elem.inner_text()
                            # Avoid extracting hidden accessibility headings
                            if title_text and len(title_text) > 5 and 'keyboard shortcuts' not in title_text.lower():
                                title = title_text.strip()
                                break
                    logger.info(f"Extracted title: {title[:50]}...")
                except Exception as e:
                    logger.warning(f"Failed to extract title: {e}")

                content_html = await page.content()
                logger.info(f"Extracted HTML content: {len(content_html)} characters")
            except Exception as e:
                logger.error(f"Error in page action: {e}")
                raise e

        try:
            cookies = self._load_cookies()
            fetch_params = {
                "page_action": _page_action,
                "headless": True,
                "timeout": 60000,
                "load_dom": True,
                "wait": 5000
            }
            if cookies:
                fetch_params["cookies"] = cookies
                logger.info(f"Launching Scrapling session with {len(cookies)} cookies")
            else:
                fetch_params["user_data_dir"] = str(self.user_data_dir)
                logger.info(f"Launching Scrapling session from {self.user_data_dir}")

            # Record Chrome PIDs before fetch
            from app.scraper import _get_chrome_pids_for_session
            pids_before = set(_get_chrome_pids_for_session(str(self.user_data_dir)))

            try:
                await StealthyFetcher.async_fetch(
                    article_url,
                    **fetch_params
                )
            finally:
                # Clean up Chrome processes spawned during this fetch
                pids_after = set(_get_chrome_pids_for_session(str(self.user_data_dir)))
                new_pids = pids_after - pids_before
                if new_pids:
                    logger.info(f"Cleaning up {len(new_pids)} Chrome processes from article fetch")
                    for pid in new_pids:
                        try:
                            os.kill(pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass

            if not content_html:
                raise Exception("Failed to extract HTML content")

            # Extract article using X's custom DOM structure
            t, s, m = self._extract_x_article(content_html, title)

            logger.info(f"Successfully processed X article: {t[:60]}...")
            return t, s, m

        except Exception as e:
            logger.error(f"Failed to fetch X article {article_url}: {e}")
            raise

    def _extract_x_article(self, html: str, page_title: str) -> tuple[str, str, str]:
        """
        Extract article content from X's specific DOM structure.
        Uses Draft.js content blocks and twitterArticleReadView container.
        Returns: (title, summary, markdown_content)
        """
        from bs4 import BeautifulSoup
        import markdownify

        soup = BeautifulSoup(html, "html.parser")

        # Try to get the article read view container
        article_view = soup.select_one('[data-testid="twitterArticleReadView"]')
        if not article_view:
            logger.warning("twitterArticleReadView not found, falling back to Readability")
            from app.content_processor import ContentProcessor
            processor = ContentProcessor()
            return processor.process_external_article(html, "")

        # Extract title from data-testid
        title = page_title
        title_elem = article_view.select_one('[data-testid="twitter-article-title"]')
        if title_elem:
            title = title_elem.get_text(strip=True)

        # Find Draft.js content blocks.
        # Prefer concrete data-block nodes to avoid missing nested content.
        content_blocks = article_view.select('div[data-contents="true"] [data-block="true"]')

        if not content_blocks:
            # Fallback: try to get all text-bearing blocks from container
            logger.warning("No Draft.js content blocks found, extracting from container")
            content_blocks = article_view.select('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, code, div')
            if not content_blocks:
                content_blocks = [article_view]

        markdown_parts = []

        for block in content_blocks:
            md_part = self._convert_block_to_markdown(block)
            if md_part:
                # De-dup consecutive identical chunks caused by mirrored wrappers.
                if not markdown_parts or markdown_parts[-1] != md_part:
                    markdown_parts.append(md_part)

        markdown_content = "\n\n".join(markdown_parts)

        # Clean up excessive blank lines
        markdown_content = re.sub(r'\n{3,}', '\n\n', markdown_content)

        # Generate summary
        plain_text = re.sub(r'[#*>\[\]!`]', '', markdown_content)
        plain_text = re.sub(r'\(http[^)]+\)', '', plain_text).strip()
        summary = plain_text[:200] + "..." if len(plain_text) > 200 else plain_text

        logger.info(f"Extracted {len(markdown_content)} chars markdown from X article with {len(markdown_parts)} blocks")
        return title, summary, markdown_content

    def _convert_block_to_markdown(self, element) -> str:
        """Convert a single Draft.js block element to markdown."""
        from bs4 import NavigableString, Tag

        if isinstance(element, NavigableString):
            return str(element).strip()

        if not isinstance(element, Tag):
            return ""

        tag = element.name
        text = element.get_text(separator="", strip=True)
        data_block = element.get("data-block", "")

        # Check for images inside this block
        imgs = element.find_all("img")
        img_markdowns = []
        for img in imgs:
            src = img.get("src", "")
            alt = img.get("alt", "Image")
            # Skip profile pics and emojis (small images)
            if not src:
                continue
            if '_x96.' in src or '_bigger.' in src or '_normal.' in src:
                continue  # Profile picture
            if 'emoji' in src or '/svg/' in src:
                continue  # Emoji SVG
            if 'format=' in src or src.startswith('https://pbs.twimg.com/media/'):
                img_markdowns.append(f"![{alt}]({src})")

        # Handle different block types
        # Strategy 1: direct h1-h6 tag
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            level = int(tag[1])
            return f"{'#' * level} {text}"

        # Strategy 2: role="heading" + aria-level (X's Draft.js renders headings this way)
        role = element.get("role", "")
        aria_level = element.get("aria-level", "")
        if role == "heading" and aria_level:
            try:
                level = max(1, min(6, int(aria_level)))
                return f"{'#' * level} {text}"
            except (ValueError, TypeError):
                pass

        # Strategy 3: nested h1-h6 tag inside a block div
        for hlevel in range(1, 7):
            nested_h = element.find(f'h{hlevel}')
            if nested_h:
                heading_text = nested_h.get_text(separator="", strip=True)
                if heading_text:
                    return f"{'#' * hlevel} {heading_text}"

        if tag == 'blockquote' or 'longform-blockquote' in element.get('class', []):
            # Blockquote in X articles
            lines = text.split('\n')
            result = '\n'.join(f"> {line}" for line in lines if line.strip())
            if img_markdowns:
                result += '\n\n' + '\n\n'.join(img_markdowns)
            return result

        if tag in ('ul', 'ol'):
            items = element.find_all('li', recursive=False)
            result_lines = []
            for i, item in enumerate(items):
                item_text = item.get_text(strip=True)
                if tag == 'ol':
                    result_lines.append(f"{i+1}. {item_text}")
                else:
                    result_lines.append(f"- {item_text}")
            return '\n'.join(result_lines)

        if tag == 'pre' or element.find('code'):
            code_elem = element.find('code') or element
            code_text = self._extract_code_text(code_elem)
            # Try to detect language from class
            lang = ""
            code_classes = (code_elem.get("class") or [])
            for cls in code_classes:
                if cls.startswith("language-"):
                    lang = cls.replace("language-", "")
            return f"```{lang}\n{code_text}\n```"

        # For generic div/p/span blocks with text + images
        parts = []
        if text:
            parts.append(text)
        if img_markdowns:
            parts.extend(img_markdowns)

        return '\n\n'.join(parts) if parts else ""

    def _extract_code_text(self, element) -> str:
        """Extract code text while preserving real line breaks and removing span-induced fake ones."""
        from bs4 import NavigableString, Tag

        parts: list[str] = []

        def walk(node):
            if isinstance(node, NavigableString):
                parts.append(str(node))
                return

            if not isinstance(node, Tag):
                return

            if node.name == 'br':
                parts.append('\n')
                return

            for child in node.children:
                walk(child)

            if node.name in ('p', 'div', 'li'):
                parts.append('\n')

        walk(element)

        code_text = ''.join(parts)
        code_text = code_text.replace('\r\n', '\n').replace('\r', '\n')
        code_text = re.sub(r'\n{3,}', '\n\n', code_text)
        code_text = '\n'.join(line.rstrip() for line in code_text.split('\n'))

        return code_text.strip('\n')

    async def is_session_valid(self) -> bool:
        """
        Check if the session is still valid by trying to access X
        """
        from scrapling.fetchers import StealthyFetcher
        is_valid = False

        async def _page_action(page):
            nonlocal is_valid
            current_url = page.url
            is_valid = '/login' not in current_url

        try:
            cookies = self._load_cookies()
            fetch_params = {
                "page_action": _page_action,
                "headless": True,
                "timeout": 15000
            }
            if cookies:
                fetch_params["cookies"] = cookies
            else:
                fetch_params["user_data_dir"] = str(self.user_data_dir)

            from app.scraper import _get_chrome_pids_for_session
            pids_before = set(_get_chrome_pids_for_session(str(self.user_data_dir)))

            try:
                await StealthyFetcher.async_fetch(
                    'https://x.com/home',
                    **fetch_params
                )
            finally:
                pids_after = set(_get_chrome_pids_for_session(str(self.user_data_dir)))
                new_pids = pids_after - pids_before
                if new_pids:
                    for pid in new_pids:
                        try:
                            os.kill(pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass

            return is_valid

        except Exception as e:
            logger.error(f"Failed to check session validity: {e}")
            return False
