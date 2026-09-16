"""Purpose-limited authentication email adapter.

This module sends only RepoInsight login/password-reset verification codes. It
is intentionally not a generic business-notification or arbitrary-email API.
"""

import html
import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Callable, Optional


LOGGER = logging.getLogger(__name__)
BREVO_AUTH_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email"
CODE_PATTERN = re.compile(r"^[0-9]{6}$")


class AuthEmailDeliveryError(RuntimeError):
    """Safe authentication-email failure without provider response details."""


def _post_json(url: str, *, headers: dict, json_payload: dict, timeout: int):
    request = urllib.request.Request(
        url,
        data=json.dumps(json_payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    return urllib.request.urlopen(request, timeout=timeout)


def send_auth_verification_email(
    recipient_email: str,
    recipient_name: str,
    code: str,
    *,
    api_key: Optional[str] = None,
    sender_email: Optional[str] = None,
    http_post: Optional[Callable] = None,
) -> None:
    """Send one fixed-purpose authentication verification email through Brevo."""
    recipient = recipient_email.strip()
    if not recipient or "@" not in recipient or not CODE_PATTERN.fullmatch(code):
        raise AuthEmailDeliveryError("Authentication email input is invalid")

    resolved_api_key = (api_key or os.environ.get("BREVO_SIB_API_V3_KEY", "")).strip()
    if not resolved_api_key:
        raise AuthEmailDeliveryError("Authentication email service is not configured")

    sender = (sender_email or os.environ.get("EMAIL_SENDER", "contact@codeinsight.dev")).strip()
    if not sender or "@" not in sender:
        raise AuthEmailDeliveryError("Authentication email sender is not configured")

    safe_name = html.escape(recipient_name.strip() or "用户")
    safe_code = html.escape(code)
    payload = {
        "sender": {"name": "RepoInsight", "email": sender},
        "to": [{"email": recipient, "name": recipient_name.strip() or recipient}],
        "subject": "RepoInsight 身份验证码",
        "htmlContent": f"""
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">RepoInsight 身份验证</h2>
            <p>您好，{safe_name}！</p>
            <p>您的登录验证码是：</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a73e8;">{safe_code}</span>
            </div>
            <p>验证码有效期为 <strong>10 分钟</strong>，请尽快使用。</p>
            <p style="color: #666; font-size: 12px;">如果您没有请求此验证码，请忽略此邮件。</p>
          </div>
        """,
    }

    try:
        if http_post is None:
            response = _post_json(
                BREVO_AUTH_EMAIL_ENDPOINT,
                headers={"api-key": resolved_api_key, "Content-Type": "application/json"},
                json_payload=payload,
                timeout=10,
            )
        else:
            response = http_post(
                BREVO_AUTH_EMAIL_ENDPOINT,
                headers={"api-key": resolved_api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=10,
            )
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        LOGGER.warning("Authentication email provider request failed")
        raise AuthEmailDeliveryError("Authentication email delivery failed") from exc

    try:
        status_code = getattr(response, "status_code", getattr(response, "status", 0))
        if status_code >= 400:
            LOGGER.warning("Authentication email provider rejected request with HTTP %s", status_code)
            raise AuthEmailDeliveryError("Authentication email delivery failed")
    finally:
        close = getattr(response, "close", None)
        if callable(close):
            close()
