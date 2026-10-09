#!/usr/bin/env bash
# Only this approved container; secrets never leave it or appear in argv.
set -euo pipefail
client=${1:?client}; shift
case "$client" in /usr/bin/mysql|/usr/bin/mysqldump) ;; *) exit 64;; esac
docker exec -i hzy-platform-dev-mysql sh -c '
 set -eu
 umask 077
 client=$1; shift
 test -n "$MYSQL_ROOT_PASSWORD_FILE" && test -s "$MYSQL_ROOT_PASSWORD_FILE"
 # File-format credentials must contain exactly one password line.
 awk "END {exit NR != 1}" "$MYSQL_ROOT_PASSWORD_FILE"
 cnf=$(mktemp /tmp/apf-platform-client.XXXXXX)
 trap '\''rm -f "$cnf"'\'' EXIT HUP INT TERM
 { printf '\''[client]\nuser=root\npassword="'\''
   sed -e '\''s/\\/\\\\/g'\'' -e '\''s/"/\\"/g'\'' "$MYSQL_ROOT_PASSWORD_FILE" | tr -d "\n"
   printf '\''"\n'\''
 } > "$cnf"
 test "$(stat -c %a "$cnf")" = 600
 status=0
 "$client" --defaults-extra-file="$cnf" "$@" || status=$?
 rm -f "$cnf"
 test ! -e "$cnf"
 trap - EXIT HUP INT TERM
 exit "$status"
' apf-client "$client" "$@"
