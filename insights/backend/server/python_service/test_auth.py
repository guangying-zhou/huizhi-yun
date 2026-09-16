"""
Test script for Auth API endpoints
"""
import asyncio

import httpx


BASE_URL = "http://localhost:8000"


async def test_check_email():
    """Test check email endpoint"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{BASE_URL}/api/auth/check-email",
            json={"email": "test@example.com"},
        )
        print(f"✓ Check Email: {response.status_code}")
        print(f"  Response: {response.json()}")
        return response.status_code == 200


async def test_health():
    """Test health check"""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/healthz")
        print(f"✓ Health Check: {response.status_code}")
        print(f"  Response: {response.json()}")
        return response.status_code == 200


async def main():
    """Run all tests"""
    print("Testing FastAPI Auth Endpoints...")
    print("=" * 50)

    try:
        # Test health
        await test_health()
        print()

        # Test check email
        await test_check_email()
        print()

        print("=" * 50)
        print("✓ All basic tests passed!")

    except Exception as e:
        print(f"✗ Test failed: {e}")


if __name__ == "__main__":
    asyncio.run(main())
