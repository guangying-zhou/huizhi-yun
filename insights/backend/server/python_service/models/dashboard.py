"""
Dashboard-related Pydantic models.
"""
from typing import Optional

from pydantic import BaseModel, Field


class DashboardStatsResponse(BaseModel):
    """Generic dashboard stats response."""

    total_contributors: int = Field(alias="totalContributors")
    total_programmers: int = Field(alias="totalProgrammers")
    total_repos: int = Field(alias="totalRepos")
    active_repos: int = Field(alias="activeRepos")
    total_loc: int = Field(alias="totalLoc")
    avg_loc: int = Field(alias="avgLoc")

    model_config = {"populate_by_name": True}


class ContributorRankingItem(BaseModel):
    """Individual contributor ranking item."""

    id: int
    name: str
    total_loc: int = Field(alias="totalLoc")
    daily_avg: int = Field(alias="dailyAvg")

    model_config = {"populate_by_name": True}


class RepoStatsResponse(BaseModel):
    """Repository statistics response."""

    total_repos: int = Field(alias="totalRepos")
    active_repos: int = Field(alias="activeRepos")
    total_commits: int = Field(alias="totalCommits")
    total_loc: int = Field(alias="totalLoc")
    avg_loc: int = Field(alias="avgLoc")
    active_threshold: int = Field(alias="activeThreshold")

    model_config = {"populate_by_name": True}


class TrendItem(BaseModel):
    """Trend data item for charts."""

    date: str
    value: int
    contributors: Optional[int] = None

    model_config = {"populate_by_name": True}
