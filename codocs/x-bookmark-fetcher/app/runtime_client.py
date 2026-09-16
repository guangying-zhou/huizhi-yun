import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class TenantRuntimeClient:
    def __init__(self):
        self.base_url = settings.hzy_tenant_runtime_url.rstrip("/")
        self.token = settings.hzy_tenant_runtime_token

    def _headers(self) -> Dict[str, str]:
        if not self.token:
            raise RuntimeError("HZY_TENANT_RUNTIME_TOKEN is required for x-bookmark-fetcher")
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        if not self.base_url:
            raise RuntimeError("HZY_TENANT_RUNTIME_URL is required for x-bookmark-fetcher")
        return f"{self.base_url}{path}"

    def _unwrap(self, payload: Dict[str, Any]) -> Any:
        if payload.get("success") is False:
            raise RuntimeError(str(payload.get("message") or "tenant-runtime request failed"))
        return payload.get("data", payload)

    def post(self, path: str, body: Dict[str, Any]) -> Any:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(self._url(path), headers=self._headers(), json=body)
            response.raise_for_status()
            return self._unwrap(response.json())

    async def apost(self, path: str, body: Dict[str, Any]) -> Any:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(self._url(path), headers=self._headers(), json=body)
            response.raise_for_status()
            return self._unwrap(response.json())

    def import_bookmarks(self, bookmarks: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.post("/v1/codocs/info/bookmarks/import", {"bookmarks": bookmarks})

    async def get_processing_bookmarks(self, bookmark_ids: List[str]) -> List[Dict[str, Any]]:
        data = await self.apost("/v1/codocs/info/bookmarks/processing", {"ids": bookmark_ids})
        return data.get("items", []) if isinstance(data, dict) else []

    async def create_info_item(
        self,
        *,
        bookmark_id: str,
        title: str,
        category: str,
        summary: Optional[str],
        author: Optional[str],
        oss_path: str,
        cover_image: Optional[str],
    ) -> Dict[str, Any]:
        data = await self.apost(
            "/v1/codocs/info/items",
            {
                "bookmark_id": bookmark_id,
                "title": title,
                "category": category,
                "summary": summary or "",
                "author": author or "",
                "oss_path": oss_path,
                "cover_image": cover_image or "",
            },
        )
        return data if isinstance(data, dict) else {}


runtime_client = TenantRuntimeClient()
