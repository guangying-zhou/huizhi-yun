import os
from typing import Optional

class Config:
    """
    Centralized configuration for CodeInsight server components.
    Defaults can be overridden by environment variables.
    """

    # Database
    DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
    DB_PORT = int(os.environ.get("DB_PORT", "3306"))
    DB_USER = os.environ.get("DB_USER", "root")
    DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
    DB_NAME = os.environ.get("DB_NAME", "hzy_repoinsight")

    # GitLab
    GITLAB_URL = os.environ.get("GITLAB_BASE_URL", os.environ.get("GITLAB_URL", "https://gitlab.wiztek.cn"))
    GITLAB_TOKEN = os.environ.get("GITLAB_BOT_TOKEN", os.environ.get("GITLAB_TOKEN", ""))
    GITLAB_BOT_USERNAME = os.environ.get("GITLAB_BOT_USERNAME", "bot")
    GITLAB_BOT_EMAIL = os.environ.get("GITLAB_BOT_EMAIL", "bot@gitlab.wiztek.cn")
    GITLAB_GROUP_ID = os.environ.get("GITLAB_GROUP_ID", "")
    # Platform Secret for auto-provisioning
    PLATFORM_SECRET = os.environ.get("PLATFORM_SECRET", "")

    # SVN
    SVN_ROOT_PATH = os.environ.get("SVN_ROOT_PATH", "/home/wiztek/svn")
    SVN_MAX_DIFF_BYTES = int(os.environ.get("SVN_MAX_DIFF_BYTES", str(512 * 1024))) # 512KB

    # Ingestion / Sync
    SYNC_PROGRESS_INTERVAL = int(os.environ.get("SYNC_PROGRESS_INTERVAL", "50"))
    FILES_BATCH_SIZE = int(os.environ.get("FILES_BATCH_SIZE", "200"))
    SYNC_INCLUDE_INACTIVE = os.environ.get("SYNC_INCLUDE_INACTIVE", "false").lower() in ("true", "1", "yes", "on")

    # Logging
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "DEBUG")

    # System
    PYTHON_BIN = os.environ.get("PYTHON_BIN", "python3")

    @classmethod
    def get_credential(cls, credential_ref: str) -> Optional[str]:
        """Resolve a credential reference (e.g., 'GITLAB_TOKEN') to its actual value.

        Args:
            credential_ref: The name of the Config attribute to look up.

        Returns:
            The credential value, or None if not found or empty.
        """
        if not credential_ref:
            return None
        value = getattr(cls, credential_ref, None)
        return value if value else None
