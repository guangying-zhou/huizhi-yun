#!/usr/bin/env python3
"""Diagnostic script to check SVN source configuration."""

import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import mysql.connector
    from server.python_service.config import Config
except ImportError as e:
    print(f"Import error: {e}")
    sys.exit(1)

def is_svn_repository(path: str) -> bool:
    """Check if a path is a valid SVN repository."""
    return os.path.isfile(os.path.join(path, "format")) and os.path.isdir(os.path.join(path, "db"))

def discover_svn_repositories(root: str):
    """Discover SVN repositories recursively."""
    print(f"\n🔍 Scanning directory: {root}")

    if not os.path.exists(root):
        print(f"❌ ERROR: Directory does not exist!")
        return []

    if not os.path.isdir(root):
        print(f"❌ ERROR: Path is not a directory!")
        return []

    repos = []
    for current, dirnames, files in os.walk(root):
        # Print current directory being scanned
        rel_path = os.path.relpath(current, root)
        print(f"  Checking: {rel_path if rel_path != '.' else '(root)'}")

        if is_svn_repository(current):
            repos.append(current)
            print(f"    ✅ Found SVN repository!")
            dirnames.clear()  # Don't recurse into repository
        else:
            # Skip hidden directories
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]

    return repos

def main():
    print("=" * 60)
    print("SVN Source Configuration Diagnostic")
    print("=" * 60)

    # Connect to database
    try:
        conn = mysql.connector.connect(
            host=Config.DB_HOST,
            port=Config.DB_PORT,
            user=Config.DB_USER,
            password=Config.DB_PASSWORD,
            database=Config.DB_NAME
        )
        print(f"✅ Connected to database: {Config.DB_NAME}")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return 1

    # Fetch SVN sources
    cursor = conn.cursor(dictionary=True)
    cursor.execute("""
        SELECT id, source_name, source_type, repos_base, is_active, sync_enabled
        FROM repo_sources
        WHERE source_type = 'SVN'
    """)
    sources = cursor.fetchall()
    cursor.close()
    conn.close()

    if not sources:
        print("\n❌ No SVN sources found in database!")
        print("\nTo add an SVN source, run:")
        print("INSERT INTO repo_sources (source_name, source_type, repos_base, is_active, sync_enabled)")
        print("VALUES ('My SVN', 'SVN', '/path/to/svn/repos', 1, 1);")
        return 1

    print(f"\n📋 Found {len(sources)} SVN source(s):\n")

    for source in sources:
        print("-" * 60)
        print(f"Source ID: {source['id']}")
        print(f"Name: {source['source_name']}")
        print(f"Type: {source['source_type']}")
        print(f"Base Path: {source['repos_base']}")
        print(f"Active: {'✅ Yes' if source['is_active'] else '❌ No'}")
        print(f"Sync Enabled: {'✅ Yes' if source['sync_enabled'] else '❌ No'}")

        if not source['is_active'] or not source['sync_enabled']:
            print("\n⚠️  This source is disabled and will not be scanned!")
            continue

        if not source['repos_base']:
            print("\n❌ repos_base is NULL or empty!")
            continue

        # Discover repositories
        repos = discover_svn_repositories(source['repos_base'])

        if repos:
            print(f"\n✅ Found {len(repos)} SVN repository/repositories:")
            for repo in repos[:10]:  # Show first 10
                rel_path = os.path.relpath(repo, source['repos_base'])
                print(f"  - {rel_path}")
            if len(repos) > 10:
                print(f"  ... and {len(repos) - 10} more")
        else:
            print(f"\n❌ No SVN repositories found!")
            print(f"\n💡 Troubleshooting tips:")
            print(f"   1. Verify the path exists and is accessible")
            print(f"   2. Check that the path contains valid SVN repositories")
            print(f"   3. SVN repositories should have 'format' file and 'db' directory")
            print(f"\n   Example valid SVN repo structure:")
            print(f"   {source['repos_base']}/")
            print(f"   ├── myrepo/")
            print(f"   │   ├── format")
            print(f"   │   ├── db/")
            print(f"   │   └── ...")

    print("\n" + "=" * 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
