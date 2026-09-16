#!/bin/bash
# mysqldump -uroot -pWiztek@1902 --default-character-set=utf8mb4 --hex-blob -c --add-drop-table wizbizdb --result-file=wizbizdb.sql

# Configuration
DB_NAME="wizbizdb"
BACKUP_DIR="/root/dbbackup"
REMOTE_DIR="/wiztek_share/dbbackup"
MYSQL_USER="root"
MYSQL_PASSWORD="Wiztek@1902"

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

# Get current date
DATE=$(date +%Y%m%d)

# Create backup filename with date
BACKUP_FILE="$BACKUP_DIR/$DB_NAME-$DATE.sql"
COMPRESSED_FILE="$BACKUP_FILE.gz"

# Perform MySQL backup
mysqldump -u$MYSQL_USER -p$MYSQL_PASSWORD $DB_NAME > $BACKUP_FILE

# Compress the backup file
gzip $BACKUP_FILE
cp $BACKUP_FILE.gz $REMOTE_DIR

# Delete files older than 30 days
find $BACKUP_DIR -name "$DB_NAME-*.sql.gz" -type f -mtime +30 -exec rm {} \;
find $REMOTE_DIR -name "$DB_NAME-*.sql.gz" -type f -mtime +30 -exec rm {} \;

# Log the backup
echo "Backup completed for $DB_NAME on $(date)" >> "$BACKUP_DIR/backup.log"
