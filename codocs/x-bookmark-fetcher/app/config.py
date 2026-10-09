import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get the project root directory
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

class Settings(BaseSettings):
    # Tenant Runtime Configuration
    hzy_tenant_runtime_url: str = ""
    hzy_tenant_runtime_token: str = ""

    # Deprecated: kept only so old .env files still parse during migration.
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = ""
    db_name: str = "codocs"

    # Aliyun OSS
    oss_access_key_id: str = ""
    oss_access_key_secret: str = ""
    oss_endpoint: str = ""
    oss_bucket_name: str = ""
    oss_bucket_domain: str = ""

    @property
    def oss_public_url(self) -> str:
        """Public URL for OSS resources. Uses custom domain if configured."""
        if self.oss_bucket_domain:
            return f"https://{self.oss_bucket_domain}"
        endpoint = self.oss_endpoint.replace("https://", "").replace("http://", "")
        return f"https://{self.oss_bucket_name}.{endpoint}"

    # App Config
    api_port: int = 8001
    x_username: str = ""
    x_password: str = ""
    x_fetcher_url: str = "http://localhost:8001"

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding='utf-8',
        case_sensitive=False
    )

settings = Settings()
