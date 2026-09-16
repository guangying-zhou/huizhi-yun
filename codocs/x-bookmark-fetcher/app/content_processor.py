import markdownify
import re
import hashlib
import logging
from readability import Document
from typing import Dict, Any, Tuple, List
from datetime import datetime
from urllib.parse import urlparse
from pathlib import PurePosixPath

logger = logging.getLogger(__name__)

class ContentProcessor:
    def process_external_article(self, html_content: str, url: str) -> Tuple[str, str, str]:
        """
        Extract clean text from an external article URL using readability, 
        then convert it to Markdown.
        Returns: (title, summary, markdown_content)
        """
        try:
            doc = Document(html_content)
            title = doc.title()
            
            # Readability extracts the main content HTML
            main_html = doc.summary()
            
            # Use markdownify to convert the clean HTML to Markdown
            markdown_content = markdownify.markdownify(main_html, heading_style="ATX")
            
            # Generate a short summary for DB
            # Remove all markdown characters for summary roughly
            plain_text = main_html.replace("<", " <").replace(">", "> ")
            plain_text = re.sub(r'<[^>]+>', '', plain_text).strip()
            summary = plain_text[:200] + "..." if len(plain_text) > 200 else plain_text
            
            return title, summary, markdown_content
        except Exception as e:
            logger.error(f"Error processing external article {url}: {e}")
            raise

    async def process_images(self, markdown_content: str, bookmark_id: str, 
                             uploader, oss_base_url: str) -> Tuple[str, List[str]]:
        """
        Find all image URLs in markdown content, download them, 
        upload to OSS info/images/, and rewrite URLs in the markdown.
        
        Args:
            markdown_content: The markdown text containing image references
            bookmark_id: Used for generating unique filenames
            uploader: OSSUploader instance
            oss_base_url: e.g. "https://bucket.oss-cn-qingdao.aliyuncs.com"
            
        Returns: (updated_markdown, list_of_oss_image_paths)
        """
        import httpx
        
        # Match both markdown images ![alt](url) and raw <img src="url"> tags
        img_pattern = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
        
        matches = list(img_pattern.finditer(markdown_content))
        if not matches:
            return markdown_content, []
        
        logger.info(f"Found {len(matches)} images in bookmark {bookmark_id}")
        
        uploaded_paths = []
        url_replacements = {}  # old_url -> new_url
        
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for idx, match in enumerate(matches):
                # Get the image URL from either markdown or img tag
                img_url = match.group(2) or match.group(3)
                
                if not img_url or img_url.startswith("data:"):
                    continue
                    
                # Skip if already processed (same URL appears multiple times)
                if img_url in url_replacements:
                    continue
                
                try:
                    # Download the image
                    resp = await client.get(img_url)
                    resp.raise_for_status()
                    image_bytes = resp.content
                    
                    if len(image_bytes) < 100:  # Skip tiny/broken images
                        logger.warning(f"Skipping tiny image ({len(image_bytes)} bytes): {img_url[:80]}")
                        continue
                    
                    # Determine file extension from URL or content-type
                    content_type = resp.headers.get("content-type", "")
                    ext = self._get_image_ext(img_url, content_type)
                    
                    # Generate a unique filename using hash to avoid duplicates
                    url_hash = hashlib.md5(img_url.encode()).hexdigest()[:10]
                    filename = f"{bookmark_id}_{idx}_{url_hash}{ext}"
                    oss_path = f"codocs/info/images/{filename}"
                    
                    # Upload to OSS
                    if uploader.upload_image(image_bytes, oss_path):
                        # Use codocs proxy URL logic
                        new_url = uploader.get_proxy_url(oss_path)
                        url_replacements[img_url] = new_url
                        uploaded_paths.append(oss_path)
                        logger.info(f"Uploaded image {idx+1}/{len(matches)}: {filename}")
                    else:
                        logger.warning(f"Failed to upload image: {img_url[:80]}")
                        
                except Exception as e:
                    logger.warning(f"Failed to download image {img_url[:80]}: {e}")
                    continue
        
        # Replace all image URLs in the markdown content
        updated_md = markdown_content
        for old_url, new_url in url_replacements.items():
            updated_md = updated_md.replace(old_url, new_url)
        
        logger.info(f"Processed {len(uploaded_paths)} images for bookmark {bookmark_id}")
        return updated_md, uploaded_paths
    
    def _get_image_ext(self, url: str, content_type: str) -> str:
        """Determine image file extension from URL path or Content-Type header."""
        # Try from URL path first
        parsed = urlparse(url)
        path = PurePosixPath(parsed.path)
        if path.suffix and path.suffix.lower() in {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif'}:
            return path.suffix.lower()
        
        # Fall back to content-type
        type_map = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'image/avif': '.avif',
        }
        for mime, ext in type_map.items():
            if mime in content_type:
                return ext
        
        return '.jpg'  # Default

    def generate_frontmatter_markdown(self, bm_info: Dict[str, Any], title: str, 
                                      content: str, image_paths: list[str], cover_image: str = "") -> str:
        """
        Wrap the extracted markdown content with YAML frontmatter.
        """
        category = bm_info.get('category', 'news')
        dt_str = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
        
        safe_title = title.replace('"', '\\"')
        frontmatter = f"""---
id: "{bm_info['id']}"
title: "{safe_title}"
author: "{bm_info['author_handle']}"
source_url: "{bm_info['source_url']}"
category: "{category}"
fetched_at: "{dt_str}"
images: {image_paths}
cover: "{cover_image}"
---

"""
        # Make sure the title is present in the markdown body as an H1 heading
        if not content.lstrip().startswith("# "):
            content = f"# {title}\n\n" + content.lstrip()
            
        # Insert cover image under the title if available
        if cover_image:
            # Find where to insert it: after the first H1 line
            lines = content.split('\n')
            if lines and lines[0].startswith("# "):
                content = lines[0] + f"\n\n![cover]({cover_image})\n\n" + '\n'.join(lines[1:])
            else:
                content = f"![cover]({cover_image})\n\n" + content
            
        return frontmatter + content
