import os
import mysql.connector
from mysql.connector import errorcode

def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", "Wiztek@1902"),
        database=os.environ.get("DB_NAME", "codeinsightdb")
    )

def create_tables():
    conn = get_db_connection()
    cursor = conn.cursor()

    tables = {}

    tables['event_levels'] = (
        "CREATE TABLE IF NOT EXISTS event_levels ("
        "  id INT AUTO_INCREMENT PRIMARY KEY,"
        "  level_name VARCHAR(50) NOT NULL,"
        "  description VARCHAR(255),"
        "  action VARCHAR(50),"
        "  report_levels INT DEFAULT 0,"
        "  is_reply_needed TINYINT(1) DEFAULT 0,"
        "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
        "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    )

    tables['monitoring_event_types'] = (
        "CREATE TABLE IF NOT EXISTS monitoring_event_types ("
        "  id INT AUTO_INCREMENT PRIMARY KEY,"
        "  event_name VARCHAR(100) NOT NULL,"
        "  description TEXT,"
        "  event_level_id INT,"
        "  monitoring_table VARCHAR(50),"
        "  eval_formula TEXT,"
        "  comparison VARCHAR(10),"
        "  monitoring_threshold VARCHAR(100),"
        "  message_template TEXT,"
        "  coder_only TINYINT(1) DEFAULT 0,"
        "  is_enabled TINYINT(1) DEFAULT 1,"
        "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
        "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,"
        "  FOREIGN KEY (event_level_id) REFERENCES event_levels(id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    )

    tables['monitoring_events'] = (
        "CREATE TABLE IF NOT EXISTS monitoring_events ("
        "  id BIGINT AUTO_INCREMENT PRIMARY KEY,"
        "  event_type_id INT,"
        "  org_department_id INT,"
        "  org_repo_id INT,"
        "  org_person_id INT,"
        "  repo_commit_id BIGINT,"
        "  event_level_id INT,"
        "  monitoring_table VARCHAR(50),"
        "  eval_formula TEXT,"
        "  comparison VARCHAR(10),"
        "  monitoring_threshold VARCHAR(100),"
        "  message TEXT,"
        "  status ENUM('PENDING', 'SENT', 'READ', 'RESOLVED', 'IGNORED') DEFAULT 'PENDING',"
        "  sent_at TIMESTAMP NULL,"
        "  read_at TIMESTAMP NULL,"
        "  resolved_at TIMESTAMP NULL,"
        "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
        "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,"
        "  FOREIGN KEY (event_type_id) REFERENCES monitoring_event_types(id),"
        "  FOREIGN KEY (event_level_id) REFERENCES event_levels(id),"
        "  INDEX idx_created_person (created_at, org_person_id),"
        "  INDEX idx_created_repo (created_at, org_repo_id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    )

    for table_name in tables:
        table_description = tables[table_name]
        try:
            print(f"Creating table {table_name}: ", end='')
            cursor.execute(table_description)
            print("OK")
        except mysql.connector.Error as err:
            if err.errno == errorcode.ER_TABLE_EXISTS_ERROR:
                print("already exists.")
            else:
                print(err.msg)

    # Insert default event levels
    print("Inserting default event levels...")
    default_levels = [
        ('最严重', 'Critical severity', 'email,sms', 31, 1), # 1+2+4+8+16 = 31 (All except GM maybe?)
        ('严重', 'High severity', 'email', 15, 1),
        ('一般', 'Medium severity', 'email', 3, 0),
        ('轻微', 'Low severity', 'email', 1, 0)
    ]

    sql_insert_level = (
        "INSERT INTO event_levels (level_name, description, action, report_levels, is_reply_needed) "
        "SELECT %s, %s, %s, %s, %s FROM DUAL "
        "WHERE NOT EXISTS (SELECT 1 FROM event_levels WHERE level_name = %s)"
    )

    for lvl in default_levels:
        cursor.execute(sql_insert_level, (*lvl, lvl[0]))

    # Insert system parameters
    print("Inserting system parameters...")
    # Parameter keys from design doc
    params = [
        ('monitoring_start_date', '2024-01-01'),
        ('monitoring_last_trigger_date', '2024-01-01'),
        ('monitoring_commit_files_threshold', '50'),
        ('monitoring_commit_files_size_threshold', '1048576'), # 1MB
        ('monitoring_commit_unexcepted_files_threshold', '5'),
        ('monitoring_commit_duplicate_files_threshold', '5'),
        ('monitoring_commit_code_lines_threshold', '1000'),
        ('monitoring_commit_quality_threshold', '80'),
        ('monitoring_repo_daily_commits_threshold', '10'),
        ('monitoring_repo_daily_code_lines_threshold', '5000'),
        ('monitoring_repo_daily_files_threshold', '100'),
        ('monitoring_repo_daily_file_size_threshold', '5242880') # 5MB
    ]

    sql_insert_param = (
        "INSERT INTO system_parameters (param_key, param_value, description) "
        "SELECT %s, %s, 'Anomaly monitoring parameter' FROM DUAL "
        "WHERE NOT EXISTS (SELECT 1 FROM system_parameters WHERE param_key = %s)"
    )

    for p in params:
        cursor.execute(sql_insert_param, (p[0], p[1], p[0]))

    conn.commit()
    cursor.close()
    conn.close()
    print("Done.")

if __name__ == "__main__":
    create_tables()
