CodeInsight ingestion as background services (systemd)

1) Prepare environment file (optional):
   sudo tee /etc/codeinsight-ingestion.env <<'EOF'
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=...
DB_NAME=codeinsightdb
GITLAB_URL=http://gitlab.example.com
GITLAB_TOKEN=glpat_xxx
FILES_BATCH_SIZE=100
SVN_MAX_DIFF_BYTES=262144
INCLUDE_INVALID= # set to 1 to include invalid repos
PYTHON_BIN=python3
EOF

2) Install units:
   # If your shell or renderer mangles wildcard (*) or hash (#), use find -exec to avoid issues
   sudo find server/scripts/systemd -maxdepth 1 -name 'codeinsight-*.service' -exec cp {} /etc/systemd/system/ \;
   sudo find server/scripts/systemd -maxdepth 1 -name 'codeinsight-*.timer' -exec cp {} /etc/systemd/system/ \;
   sudo systemctl daemon-reload

3) Enable and start timers:
   sudo systemctl enable --now codeinsight-sync-commits.timer
   sudo systemctl enable --now codeinsight-ingest-files.timer

4) Check status and logs:
   systemctl status codeinsight-sync-commits.timer codeinsight-ingest-files.timer
   journalctl -u codeinsight-sync-commits.service -u codeinsight-ingest-files.service -e

5) Manual trigger via API:
   POST /api/ingestion/files/start { "batchSize": 100, "includeInvalid": false, "triggeredBy": "admin" }
   GET  /api/ingestion/files/progress
   GET  /api/ingestion/files/logs?runId=<id>&limit=500

Rendering notes (added 2025-11-11T19:21:03.618Z)
- If you need to literally show a wildcard, write codeinsight-\*.service (escaped) in prose.
- Shell commands above already avoid renderer pitfalls by using find -exec and quoted patterns.

Notes
- Stage A: metadata only; Stage B: files & dedupe.
- Concurrency: flock ensures at most one active run per stage.
- Adjust timers: change OnUnitActiveSec intervals as needed.
- Reduce memory: lower FILES_BATCH_SIZE or raise swap.
