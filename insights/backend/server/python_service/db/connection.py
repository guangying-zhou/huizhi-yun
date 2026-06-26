"""
Database connection and session management for FastAPI.

Uses aiomysql for async MySQL connections with SQLAlchemy 2.0.
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from urllib.parse import quote_plus

import aiomysql
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from server.python_service.config import Config

# Create async engine with properly encoded credentials
# URL-encode password to handle special characters like @
encoded_password = quote_plus(Config.DB_PASSWORD)
engine = create_async_engine(
    f"mysql+aiomysql://{Config.DB_USER}:{encoded_password}@{Config.DB_HOST}:{Config.DB_PORT}/{Config.DB_NAME}",
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=False,  # Set to True for SQL query logging during development
)

# Create async session factory
AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency for FastAPI routes to get database session.

    Usage:
        @app.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            result = await db.execute(select(Item))
            return result.scalars().all()
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def execute_query(query: str, params: tuple = ()) -> list[dict]:
    """
    Execute a raw SQL query and return results as list of dicts.

    This is a helper for migration from Node.js queries.
    Prefer using SQLAlchemy ORM queries when possible.

    Args:
        query: SQL query string with %s placeholders
        params: Tuple of parameters for the query

    Returns:
        List of dictionaries representing rows
    """
    from sqlalchemy import text

    # Convert %s placeholders to :param{n} format for SQLAlchemy
    param_dict = {f"param{i}": v for i, v in enumerate(params)}
    sql_query = query
    for i in range(len(params)):
        sql_query = sql_query.replace("%s", f":param{i}", 1)

    async with engine.begin() as conn:
        result = await conn.execute(text(sql_query), param_dict)
        if result.returns_rows:
            columns = result.keys()
            return [dict(zip(columns, row)) for row in result.fetchall()]
        return []


async def execute_update(query: str, params: tuple = ()) -> int:
    """
    Execute an INSERT/UPDATE/DELETE query.

    Args:
        query: SQL query string
        params: Tuple of parameters

    Returns:
        Number of affected rows
    """
    from sqlalchemy import text

    # Convert %s placeholders to :param{n} format
    param_dict = {f"param{i}": v for i, v in enumerate(params)}
    sql_query = query
    for i in range(len(params)):
        sql_query = sql_query.replace("%s", f":param{i}", 1)

    async with engine.begin() as conn:
        result = await conn.execute(text(sql_query), param_dict)
        return result.rowcount


async def execute_insert(query: str, params: tuple = ()) -> int:
    """
    Execute an INSERT query and return the last inserted ID.

    Args:
        query: SQL query string
        params: Tuple of parameters

    Returns:
        Last inserted row ID
    """
    from sqlalchemy import text

    param_dict = {f"param{i}": v for i, v in enumerate(params)}
    sql_query = query
    for i in range(len(params)):
        sql_query = sql_query.replace("%s", f":param{i}", 1)

    async with engine.begin() as conn:
        result = await conn.execute(text(sql_query), param_dict)
        return result.lastrowid
