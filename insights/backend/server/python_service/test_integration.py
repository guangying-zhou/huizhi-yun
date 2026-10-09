#!/usr/bin/env python3
"""
Integration test script for FastAPI backend.

Tests all major API endpoints to verify functionality.
"""
import asyncio
import httpx


BASE_URL = "http://127.0.0.1:8000"


async def test_health():
    """Test health check."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/healthz")
        assert response.status_code == 200
        print("✅ Health check passed")
        return True


async def test_auth_check_email():
    """Test auth check email."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{BASE_URL}/api/auth/check-email",
            json={"email": "test@example.com"},
        )
        assert response.status_code == 200
        print(f"✅ Auth check-email: {response.json()}")
        return True


async def test_dashboard_contributors_stats():
    """Test dashboard contributors stats."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/api/dashboard/contributors/stats")
        assert response.status_code == 200
        data = response.json()
        print(f"✅ Contributors stats: {data['totalContributors']} contributors, {data['totalLoc']:,} LOC")
        return True


async def test_dashboard_repos_stats():
    """Test dashboard repos stats."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/api/dashboard/repos/stats")
        assert response.status_code == 200
        data = response.json()
        print(f"✅ Repos stats: {data['totalRepos']} repos, {data['totalCommits']:,} commits")
        return True


async def test_repos_list():
    """Test repos listing."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/api/repos?page=1&pageSize=5")
        assert response.status_code == 200
        data = response.json()
        print(f"✅ Repos list: Retrieved {len(data)} repos")
        if data:
            print(f"   First repo: {data[0]['name']}")
        return True


async def test_contributors_list():
    """Test contributors listing."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/api/contributors?page=1&pageSize=5")
        assert response.status_code == 200
        data = response.json()
        print(f"✅ Contributors list: Retrieved {len(data)} contributors")
        if data:
            print(f"   First: {data[0]['name']}")
        return True


async def test_active_repos():
    """Test active repos count."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/api/repos/active")
        assert response.status_code == 200
        data = response.json()
        print(f"✅ Active repos: {data['count']}")
        return True


async def test_departments_treemap():
    """Test departments treemap."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/api/dashboard/departments/treemap")
        assert response.status_code == 200
        data = response.json()
        print(f"✅ Departments: {len(data)} departments")
        return True


async def count_total_endpoints():
    """Count total API endpoints."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/openapi.json")
        data = response.json()
        paths = list(data['paths'].keys())

        # Categorize
        auth = [p for p in paths if '/auth' in p]
        dashboard = [p for p in paths if '/dashboard' in p]
        repos_mgmt = [p for p in paths if p.startswith('/api/repos') and '/dashboard' not in p]
        contrib_mgmt = [p for p in paths if p.startswith('/api/contributors')]
        ingestion = [p for p in paths if any(x in p for x in ['/gitlab', '/svn', '/run', '/ingestion', '/deduplicate', '/repos/scan'])]

        print("\n" + "="*60)
        print("API Endpoint Summary")
        print("="*60)
        print(f"Total Endpoints: {len(paths)}")
        print(f"  - Auth: {len(auth)}")
        print(f"  - Dashboard: {len(dashboard)}")
        print(f"  - Repos Management: {len(repos_mgmt)}")
        print(f"  - Contributors Management: {len(contrib_mgmt)}")
        print(f"  - Ingestion: {len(ingestion)}")
        print(f"  - Other: {len(paths) - len(auth) - len(dashboard) - len(repos_mgmt) - len(contrib_mgmt) - len(ingestion)}")
        print("="*60)

        return len(paths)


async def main():
    """Run all integration tests."""
    print("\n🚀 Starting FastAPI Integration Tests\n")

    tests = [
        test_health,
        test_auth_check_email,
        test_dashboard_contributors_stats,
        test_dashboard_repos_stats,
        test_repos_list,
        test_contributors_list,
        test_active_repos,
        test_departments_treemap,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            await test()
            passed += 1
        except Exception as e:
            print(f"❌ {test.__name__} failed: {e}")
            failed += 1

    # Count endpoints
    await count_total_endpoints()

    print(f"\n{'='*60}")
    print(f"Test Results: {passed} passed, {failed} failed")
    print(f"{'='*60}\n")

    return failed == 0


if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)
