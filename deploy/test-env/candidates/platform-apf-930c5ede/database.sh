#!/usr/bin/env bash
# Candidate only. Run on approved Platform test host, never during preparation.
set -euo pipefail
umask 077
[[ ${APF_RELEASE_APPROVAL:-} == platform-930c5ede-C000001-test ]] || exit 64
[[ $(hostname) == iZcqwiqyhp9u8rZ ]] || exit 64
: "${BACKUP_KEY:?protected key file}" "${ATTEMPT:?private attempt dir}" "${SOURCE:?clean candidate repo}"
[[ $(stat -c %a "$BACKUP_KEY") == 600 && $(stat -c %a "$ATTEMPT") == 700 ]] || exit 64
if [[ -n ${APF_MYSQL_CONTAINER:-} ]]; then
 [[ "$APF_MYSQL_CONTAINER" == hzy-platform-dev-mysql ]] || exit 64
else
 : "${MYSQL_CNF:?0600 existing protected defaults file}"
 [[ $(stat -c %a "$MYSQL_CNF") == 600 ]] || exit 64
fi
DB=hzy_platform_dev
SQL="$SOURCE/platform/docs/sql"
docker_client() {
 bash "$(dirname "$0")/container-client.sh" "$@"
}
mysqlq() {
 if [[ -n ${APF_MYSQL_CONTAINER:-} ]]; then
  docker_client /usr/bin/mysql --batch --skip-column-names "$DB" "$@"
 else mysql --defaults-extra-file="$MYSQL_CNF" --batch --skip-column-names "$DB" "$@"; fi
}
dumpq() {
 if [[ -n ${APF_MYSQL_CONTAINER:-} ]]; then docker_client /usr/bin/mysqldump "$@"
 else mysqldump --defaults-extra-file="$MYSQL_CNF" "$@"; fi
}
# No stderr/body is sent to terminal: keep diagnostic files private.
exec 2>"$ATTEMPT/database-error.log"
case ${1:-} in
 backup)
  [[ -f "$ATTEMPT/rollback.config.json" ]] || exit 65
  pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{if(JSON.parse(s).find(p=>p.name==="hzy-platform-dev")?.pm2_env.status!=="stopped")process.exit(65)})'
  [[ ! -e "$ATTEMPT/platform-before.sql.enc" ]] || exit 65
  dumpq --single-transaction --routines --events --triggers --hex-blob "$DB" \
   | openssl enc -aes-256-cbc -salt -pbkdf2 -pass file:"$BACKUP_KEY" -out "$ATTEMPT/platform-before.sql.enc"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$BACKUP_KEY" -in "$ATTEMPT/platform-before.sql.enc" | sha256sum > "$ATTEMPT/decrypted.sha256"
  # Restore into a separately approved isolated MySQL server, with events disabled.
  : "${RESTORE_MYSQL_CNF:?0600 isolated restore-server defaults file}"
  [[ $(stat -c %a "$RESTORE_MYSQL_CNF") == 600 && ${APF_RESTORE_APPROVAL:-} == isolated-platform-restore ]] || exit 64
  restoreq() { mysql --defaults-extra-file="$RESTORE_MYSQL_CNF" --batch --skip-column-names "$@"; }
  [[ $(restoreq -e "SELECT @@server_uuid") != $(mysqlq -e "SELECT @@server_uuid") ]] || exit 65
  [[ $(restoreq -e "SELECT @@event_scheduler") == OFF ]] || exit 65
  [[ $(restoreq -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$DB'") == 0 ]] || exit 65
  restoreq -e "CREATE DATABASE $DB"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$BACKUP_KEY" -in "$ATTEMPT/platform-before.sql.enc" \
   | restoreq "$DB"
  # Compare base-table list and every logical checksum, with Platform writers fenced.
  mysqlq -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME" > "$ATTEMPT/tables.txt"
  restoreq "$DB" -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME" > "$ATTEMPT/restore-tables.txt"
  cmp "$ATTEMPT/tables.txt" "$ATTEMPT/restore-tables.txt"
  while IFS= read -r table; do
   [[ "$table" =~ ^[A-Za-z0-9_]+$ ]] || exit 65
   a=$(mysqlq -e "CHECKSUM TABLE \`$DB\`.\`$table\`" | cut -f2)
   b=$(restoreq "$DB" -e "CHECKSUM TABLE \`$DB\`.\`$table\`" | cut -f2)
   [[ "$a" != NULL && "$a" == "$b" ]] || exit 65
  done < "$ATTEMPT/tables.txt"
  objects="SELECT 'views',COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA='$DB' UNION ALL SELECT 'routines',COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='$DB' UNION ALL SELECT 'events',COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA='$DB' UNION ALL SELECT 'triggers',COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='$DB'"
  mysqlq -e "$objects" > "$ATTEMPT/objects-before.txt"
  restoreq "$DB" -e "$objects" > "$ATTEMPT/objects-restored.txt"
  cmp "$ATTEMPT/objects-before.txt" "$ATTEMPT/objects-restored.txt"
  restoreq -e "DROP DATABASE $DB"
  touch "$ATTEMPT/backup-restore-verified"
  ;;
 migrate)
  pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{if(JSON.parse(s).find(p=>p.name==="hzy-platform-dev")?.pm2_env.status!=="stopped")process.exit(65)})'
  [[ -f "$ATTEMPT/backup-restore-verified" ]] || exit 65
  cols=$(mysqlq -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_app_role_scopes' AND COLUMN_NAME='source_type'")
  [[ "$cols" == 0 ]] || exit 65 # Partial/previous installation requires human review, no blind retry.
  mysqlq < "$SQL/HZY-Platform-SQL-Migration-finance-manifest-default-scopes-candidate.sql"
  [[ $(mysqlq -e "SELECT COUNT(*) FROM platform_app_role_scopes WHERE source_type<>'manual'") == 0 ]] || exit 65
  touch "$ATTEMPT/migrated"
  ;;
 verify)
  mysqlq < "$SQL/HZY-Platform-SQL-Verify-finance-manifest-default-scopes-candidate.sql" > "$ATTEMPT/scopes-verify.txt"
  [[ $(mysqlq -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_app_role_scopes' AND COLUMN_NAME='source_type' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='manual'") == 1 ]] || exit 65
  [[ $(mysqlq -e "SELECT COUNT(*) FROM platform_app_role_scopes s LEFT JOIN platform_app_role_permissions p ON p.app_role_id=s.app_role_id AND p.app_code=s.app_code AND p.resource_code=s.resource_code AND p.action=s.action WHERE s.source_type='manifest_default' AND p.app_role_id IS NULL") == 0 ]] || exit 65
  [[ $(mysqlq -e "SELECT COUNT(*) FROM platform_app_role_scopes s JOIN platform_app_roles r ON r.id=s.app_role_id WHERE s.app_code='finance' AND s.source_type='manifest_default' AND NOT ((r.role_code IN ('finance:admin','finance:manager') AND s.scope_type='tenant' AND s.scope_value='global') OR (r.role_code='finance:expense_submitter' AND s.resource_code='expenses' AND s.scope_type='subject' AND s.scope_value='self'))") == 0 ]] || exit 65
  ;;
 *) exit 64 ;;
esac
printf '%s\n' "database ${1}: PASS"
