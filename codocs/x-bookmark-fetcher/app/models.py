from enum import Enum
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class BookmarkStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    PROCESSED = "processed"
    IGNORED = "ignored"

class InfoCategory(str, Enum):
    NEWS = "news"
    ARTICLE = "article"
    AUTO = "auto"

class BookmarkInfo(BaseModel):
    id: str
    author_handle: str
    content_snippet: str
    source_url: str
    has_external_link: bool
    status: BookmarkStatus = BookmarkStatus.PENDING

class ProcessRequest(BaseModel):
    bookmark_ids: List[str]
    category: InfoCategory
