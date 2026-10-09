import oss2
import logging
import io
from app.config import settings

logger = logging.getLogger(__name__)

class OSSUploader:
    def __init__(self):
        auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
        self.bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket_name)

    def upload_markdown(self, content: str, remote_path: str) -> bool:
        """
        Uploads an in-memory markdown string to Aliyun OSS.
        remote_path example: `codocs/info/articles/2026-02-26_12345.md`
        """
        try:
            logger.info(f"Uploading markdown to OSS: {remote_path}")
            result = self.bucket.put_object(remote_path, content.encode('utf-8'))
            return result.status == 200
        except Exception as e:
            logger.error(f"Failed to upload markdown to OSS ({remote_path}): {e}")
            return False

    def upload_image(self, image_bytes: bytes, remote_path: str) -> bool:
        """
        Uploads an image (bytes) to OSS.
        remote_path example: `codocs/info/images/abc.jpg`
        """
        try:
            logger.info(f"Uploading image to OSS: {remote_path}")
            result = self.bucket.put_object(remote_path, image_bytes)
            return result.status == 200
        except Exception as e:
            logger.error(f"Failed to upload image to OSS ({remote_path}): {e}")
            return False

    def get_signed_url(self, remote_path: str, expires: int = 3600) -> str:
        """
        Generate a signed URL for a private OSS object.
        Matches the logic in codocs/server/utils/oss.ts
        """
        try:
            # Generate the signed URL
            url = self.bucket.sign_url('GET', remote_path, expires)
            
            # Replace with custom domain if configured
            if settings.oss_bucket_domain:
                from urllib.parse import urlparse, urlunparse
                parsed = urlparse(url)
                # Replace the netloc (host) with the custom domain
                # e.g. wiz-rs.oss-cn-qingdao.aliyuncs.com -> rs.wiztek.cn
                new_netloc = settings.oss_bucket_domain
                new_url = urlunparse((
                    'https',          # Force HTTPS
                    new_netloc,       # New domain
                    parsed.path, 
                    parsed.params, 
                    parsed.query, 
                    parsed.fragment
                ))
                return new_url
                
            return url
        except Exception as e:
            logger.error(f"Failed to generate signed URL for {remote_path}: {e}")
            return f"/{remote_path}"  # Fallback

    def get_proxy_url(self, remote_path: str) -> str:
        """
        Generate Nuxt proxy URL for the OSS object.
        This bypasses Signed URL expiration by securely downloading the image on the Nuxt backend.
        """
        import urllib.parse
        encoded_path = urllib.parse.quote(remote_path)
        return f"/api/oss/image?path={encoded_path}"
