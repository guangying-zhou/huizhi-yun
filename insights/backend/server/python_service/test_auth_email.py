import unittest
import urllib.error
from pathlib import Path

from server.python_service.utils.auth_email import (
    BREVO_AUTH_EMAIL_ENDPOINT,
    AuthEmailDeliveryError,
    send_auth_verification_email,
)


class FakeResponse:
    def __init__(self, status_code=201):
        self.status_code = status_code
        self.text = "provider body must never be consumed or logged"
        self.closed = False

    def close(self):
        self.closed = True


class AuthEmailTest(unittest.TestCase):
    def test_sends_only_fixed_authentication_template(self):
        calls = []

        def post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse()

        send_auth_verification_email(
            "user@example.com",
            "<Admin>",
            "123456",
            api_key="test-key",
            sender_email="auth@example.com",
            http_post=post,
        )

        self.assertEqual(len(calls), 1)
        url, kwargs = calls[0]
        self.assertEqual(url, BREVO_AUTH_EMAIL_ENDPOINT)
        self.assertEqual(kwargs["json"]["subject"], "RepoInsight 身份验证码")
        self.assertIn("&lt;Admin&gt;", kwargs["json"]["htmlContent"])
        self.assertNotIn("<Admin>", kwargs["json"]["htmlContent"])
        self.assertEqual(kwargs["timeout"], 10)

    def test_auth_route_has_no_generic_or_direct_brevo_sender(self):
        source = Path(__file__).with_name("api").joinpath("auth.py").read_text(encoding="utf-8")
        self.assertNotIn("api.brevo.com", source)
        self.assertNotIn("BREVO_SIB_API_V3_KEY", source)
        self.assertNotIn("response.text", source)
        self.assertNotIn("return_code", source)
        self.assertIn("send_auth_verification_email", source)

    def test_rejects_missing_credentials_and_non_auth_code(self):
        with self.assertRaises(AuthEmailDeliveryError):
            send_auth_verification_email("user@example.com", "User", "123456", api_key="")
        with self.assertRaises(AuthEmailDeliveryError):
            send_auth_verification_email("user@example.com", "User", "arbitrary body", api_key="key")

    def test_provider_error_is_fixed_and_does_not_expose_response(self):
        def rejected(*_args, **_kwargs):
            return FakeResponse(400)

        with self.assertRaisesRegex(AuthEmailDeliveryError, "Authentication email delivery failed") as caught:
            send_auth_verification_email("user@example.com", "User", "123456", api_key="key", http_post=rejected)
        self.assertNotIn("provider body", str(caught.exception))

        def failed(*_args, **_kwargs):
            raise urllib.error.URLError("URL?api-key=secret")

        with self.assertRaisesRegex(AuthEmailDeliveryError, "Authentication email delivery failed") as caught:
            send_auth_verification_email("user@example.com", "User", "123456", api_key="key", http_post=failed)
        self.assertNotIn("secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
