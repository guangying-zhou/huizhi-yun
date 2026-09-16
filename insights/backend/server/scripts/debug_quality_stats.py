import os
import sys
import mysql.connector
from server.python_service.config import Config

def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", Config.DB_HOST),
        port=int(os.environ.get("DB_PORT", Config.DB_PORT)),
        user=os.environ.get("DB_USER", Config.DB_USER),
        password=os.environ.get("DB_PASSWORD", Config.DB_PASSWORD),
        database=os.environ.get("DB_NAME", Config.DB_NAME)
    )

def main():
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # Check 2025 monthly stats
    print("--- Monthly Stats 2025 ---")
    query = """
    SELECT
        stat_month,
        SUM(lines_added + lines_deleted + lines_modified) as total_change_lines,
        SUM(total_commits) as total_commits,

        SUM(files_added + code_files_modified + binary_files_modified) as valid_files,
        SUM(files_in_banned_directories + files_unexpected + code_files_duplicated + binary_files_duplicated) as noise_files,

        -- Code Quality Formula
        CASE WHEN SUM(total_commits) = 0 THEN 0
        ELSE GREATEST(0, 100.0 - ABS(50.0 - SUM(lines_added + lines_deleted + lines_modified) / SUM(total_commits)) * 0.2)
        END as code_quality,

        -- Submission Quality Formula
        CASE WHEN SUM(files_added + code_files_modified + binary_files_modified + files_in_banned_directories + files_unexpected + code_files_duplicated + binary_files_duplicated) = 0 THEN 100
        ELSE (SUM(files_added + code_files_modified + binary_files_modified)) * 100.0 / SUM(files_added + code_files_modified + binary_files_modified + files_in_banned_directories + files_unexpected + code_files_duplicated + binary_files_duplicated)
        END as submission_quality

    FROM stat_repo_monthly
    WHERE stat_year = 2025
    GROUP BY stat_month
    ORDER BY stat_month
    """
    cursor.execute(query)
    months = cursor.fetchall()

    total_lines = 0
    total_commits = 0
    total_valid = 0
    total_noise = 0

    print(f"{'Month':<6} | {'Lines':<10} | {'Commits':<8} | {'AvgLn/Cmt':<10} | {'Score(CQ)':<10} | {'ValidFiles':<10} | {'NoiseFiles':<10} | {'Score(SQ)':<10}")
    print("-" * 100)

    for row in months:
        avg_lines = row['total_change_lines'] / row['total_commits'] if row['total_commits'] else 0
        print(f"{row['stat_month']:<6} | {int(row['total_change_lines']):<10} | {int(row['total_commits']):<8} | {avg_lines:<10.1f} | {row['code_quality']:<10.1f} | {int(row['valid_files']):<10} | {int(row['noise_files']):<10} | {row['submission_quality']:<10.1f}")

        total_lines += row['total_change_lines']
        total_commits += row['total_commits']
        total_valid += row['valid_files']
        total_noise += row['noise_files']

    print("-" * 100)

    # Yearly Aggregate
    yearly_avg_lines = total_lines / total_commits if total_commits else 0
    yearly_cq = max(0, 100 - abs(50 - yearly_avg_lines) * 0.2)

    yearly_sq_denom = total_valid + total_noise
    yearly_sq = (total_valid * 100.0 / yearly_sq_denom) if yearly_sq_denom else 100

    print("--- Yearly Aggregate (Weighted) ---")
    print(f"Total Lines: {int(total_lines)}")
    print(f"Total Commits: {int(total_commits)}")
    print(f"Avg Lines/Commit: {yearly_avg_lines:.1f}")
    print(f"Calculated Yearly Code Quality: {yearly_cq:.1f}")
    print(f"Calculated Yearly Submission Quality: {yearly_sq:.1f}")

    cursor.close()
    conn.close()

if __name__ == "__main__":
    main()
