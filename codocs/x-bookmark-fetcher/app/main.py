from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import asyncio
import logging
from contextlib import asynccontextmanager

from app.models import ProcessRequest, InfoCategory
from app.config import settings
from app.scraper import XBookmarkScraper, save_bookmarks_to_runtime, cleanup_chrome_processes
from app.runtime_client import runtime_client
from app.content_processor import ContentProcessor
from app.oss_uploader import OSSUploader
from app.x_article_scraper import XArticleScraper
import httpx
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Scheduler for periodic scraping
scheduler = AsyncIOScheduler()

# Concurrency flag: prevent multiple simultaneous scraping sessions
_sync_running = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Clean up any orphaned Chrome processes from previous runs
    logger.info("Cleaning up orphaned Chrome processes...")
    await asyncio.to_thread(cleanup_chrome_processes)

    # Startup: Start the scheduler
    logger.info("Starting scheduler...")
    scheduler.start()
    # Add daily sync job (example: every 6 hours)
    scheduler.add_job(
        sync_bookmarks_job,
        'interval',
        hours=6,
        id='sync_bookmarks_job',
        replace_existing=True
    )
    yield
    # Shutdown: Stop the scheduler
    logger.info("Shutting down scheduler...")
    scheduler.shutdown()
    # Shutdown: Clean up Chrome processes
    await asyncio.to_thread(cleanup_chrome_processes)

app = FastAPI(title="x-bookmark-fetcher", lifespan=lifespan)

# Allow CORS for Codocs
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def sync_bookmarks_job():
    """Background job to fetch new bookmarks and save to MySQL"""
    global _sync_running
    if _sync_running:
        logger.warning("Sync job skipped: another sync is already running")
        return
    _sync_running = True
    try:
        logger.info("Running scheduled bookmark sync...")
        scraper = XBookmarkScraper()
        bookmarks = await scraper.fetch_new_bookmarks()
        save_bookmarks_to_runtime(bookmarks)
    except Exception as e:
        logger.error(f"Error during bookmark sync task: {e}")
    finally:
        cleanup_chrome_processes()
        _sync_running = False

@app.get("/status")
async def get_status():
    """Check the status of the fetcher service"""
    jobs = scheduler.get_jobs()
    next_run = None
    for job in jobs:
        if job.id == 'sync_bookmarks_job':
            next_run = job.next_run_time
    
    return {
        "status": "running",
        "scheduler_running": scheduler.running,
        "next_sync_run": next_run
    }

@app.post("/sync")
async def trigger_sync(background_tasks: BackgroundTasks):
    """Manually trigger a bookmark sync"""
    if _sync_running:
        raise HTTPException(status_code=409, detail="A sync job is already running")
    background_tasks.add_task(sync_bookmarks_job)
    return {"message": "Sync job started in the background."}

@app.post("/process")
async def process_bookmarks(request: ProcessRequest, background_tasks: BackgroundTasks):
    """
    Called by Codocs Admin UI to process selected bookmarks:
    - Download images, upload to OSS
    - Generate Markdown, upload to OSS
    - Update bookmark and info metadata through tenant-runtime
    """
    logger.info(f"Received request to process {len(request.bookmark_ids)} bookmarks as {request.category}")
    
    def _is_x_article_url(url: str) -> bool:
        """Detect X/Twitter native article URLs (various formats)."""
        return (
            '/x.com/i/article/' in url
            or '/twitter.com/i/article/' in url
            or '/x.com/i/articles/' in url
            or '/twitter.com/i/articles/' in url
        )

    async def _process_task(bookmark_ids, category):
        logger.info(f"Processing bookmarks: {bookmark_ids}")
        try:
            pending_bks = await runtime_client.get_processing_bookmarks(bookmark_ids)

            processor = ContentProcessor()
            uploader = OSSUploader()

            for bk in pending_bks:
                logger.info(f"Processing bookmark {bk['id']} - Source: {bk['source_url']}")
                # Use article_title from DB if available, otherwise fall back to snippet prefix
                if bk.get('article_title'):
                    title = bk['article_title']
                elif bk['content_snippet']:
                    title = bk['content_snippet'][:80].rstrip() + ("..." if len(bk['content_snippet']) > 80 else "")
                else:
                    title = f"Bookmark {bk['id']}"
                summary = bk['content_snippet']
                markdown_content = bk.get('full_content') or bk['content_snippet']

                # If external link, try to fetch the actual article content
                if bk['has_external_link']:
                    source_url = bk['source_url']

                    # Handle X/Twitter article links with authenticated session
                    if _is_x_article_url(source_url):
                        logger.info(f"Attempting to fetch X article for {bk['id']}: {source_url}")
                        try:
                            x_scraper = XArticleScraper()
                            t, s, m = await x_scraper.fetch_article_content(source_url)
                            
                            # Validate content - check if it's actually article content
                            invalid_texts = ['Something went wrong', 'privacy related extensions']
                            is_invalid = any(text in m for text in invalid_texts)
                            
                            if not is_invalid and len(m.strip()) > 300:  # Has substantial content
                                # If title is missing or just 'X', use the snippet or URL
                                if not t or t == '[no-title]' or t == 'X':
                                    title = bk['content_snippet'][:50] + "..." if bk['content_snippet'] else f"X Article {bk['id']}"
                                else:
                                    title = t
                                summary = s or summary
                                original_tweet = f"> **Original Bookmark Context:**\n> {bk['content_snippet'].replace(chr(10), chr(10) + '> ')}\n\n---\n\n"
                                markdown_content = original_tweet + m
                                logger.info(f"Successfully fetched X article: {title[:50]}...")
                            else:
                                logger.warning(f"X article content invalid or session expired for {bk['id']}, using snippet")
                                logger.warning(f"Hint: X session may need refresh. Run 'python test_session.py' to check")
                        except Exception as e:
                            logger.error(f"Failed to fetch X article for {bk['id']}: {e}")
                            logger.info(f"Falling back to snippet for X article {bk['id']}")
                            # Fallback to snippet - it's already set as default
                    else:
                        # Handle other external links
                        try:
                            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                                resp = await client.get(source_url)
                                resp.raise_for_status()
                                t, s, m = processor.process_external_article(resp.text, source_url)
                                
                                # Validate content - check if it's an error page or too short (which usually means a JS-only SPA page)
                                invalid_texts = ['Something went wrong', 'Responses are generated using AI', 'AI usage']
                                is_invalid = any(text in m for text in invalid_texts)
                                
                                if not t or t == '[no-title]' or is_invalid or len(m.strip()) < 200:
                                    logger.warning(f"Invalid, error, boilerplate, or too short content for {bk['id']}, using snippet")
                                else:
                                    title = t if t else title
                                    summary = s if s else summary
                                    # Always keep the original tweet as context
                                    original_tweet = f"> **Original Bookmark Context:**\n> {bk['content_snippet'].replace(chr(10), chr(10) + '> ')}\n\n---\n\n"
                                    markdown_content = original_tweet + m
                        except Exception as e:
                            logger.error(f"Failed to fetch/parse external article for {bk['id']}: {e}")
                            # Fallback to just the snippet if it fails
                
                # Determine the effective category for this bookmark
                if category == InfoCategory.AUTO:
                    # X native article URLs are always articles, regardless of content fetch result
                    if _is_x_article_url(bk['source_url']):
                        effective_category = 'article'
                    # External links with substantial extracted content → article
                    elif bk['has_external_link'] and len(markdown_content) > 300:
                        effective_category = 'article'
                    else:
                        effective_category = 'news'
                    logger.info(f"Auto-classified bookmark {bk['id']} as '{effective_category}'")
                else:
                    effective_category = category.value
                
                # Process images in the markdown content
                # Download images, upload to OSS, and rewrite URLs
                image_paths = []
                final_cover_image = ""
                
                # If there's a cover_image from DB, we can manually "process" it by throwing it into a dummy markdown
                if bk.get('cover_image'):
                    try:
                        dummy_md = f"![cover]({bk['cover_image']})"
                        _, cover_paths = await processor.process_images(
                            dummy_md, f"cover_{bk['id']}", uploader, settings.oss_public_url
                        )
                        if cover_paths:
                            # Use permanent proxy URL (bypasses OSS ACL issues)
                            final_cover_image = uploader.get_proxy_url(cover_paths[0])
                    except Exception as e:
                        logger.warning(f"Cover image processing failed for {bk['id']}: {e}")

                if len(markdown_content) > 300:  # Only process images for substantial content
                    try:
                        markdown_content, image_paths = await processor.process_images(
                            markdown_content, str(bk['id']), uploader, settings.oss_public_url
                        )
                    except Exception as e:
                        logger.warning(f"Image processing failed for {bk['id']}: {e}")
                
                # Combine into final markdown with frontmatter
                # Add category to bookmark info
                bk_with_category = {**bk, 'category': effective_category}
                final_md = processor.generate_frontmatter_markdown(bk_with_category, title, markdown_content, image_paths, final_cover_image)
                # Upload to OSS
                date_str = datetime.utcnow().strftime('%Y-%m-%d')
                cat_folder = "articles" if effective_category == 'article' else "news"
                oss_path = f"codocs/info/{cat_folder}/{date_str}_{bk['id']}.md"
                
                if uploader.upload_markdown(final_md, oss_path):
                    await runtime_client.create_info_item(
                        bookmark_id=str(bk['id']),
                        title=title,
                        category=effective_category,
                        summary=summary,
                        author=bk.get('author_handle'),
                        oss_path=oss_path,
                        cover_image=final_cover_image
                    )
                    logger.info(f"Successfully processed bookmark {bk['id']} to {oss_path}")
                else:
                    logger.error(f"Failed to upload {bk['id']} to OSS.")
        except Exception as e:
            logger.error(f"Error during background processing: {e}")
        
    background_tasks.add_task(_process_task, request.bookmark_ids, request.category)
    return {"message": f"Processing {len(request.bookmark_ids)} bookmarks in the background."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.api_port, reload=True)
