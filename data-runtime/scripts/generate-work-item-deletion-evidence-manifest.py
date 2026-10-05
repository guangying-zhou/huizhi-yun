#!/usr/bin/env python3
"""Generate the fixed evidence installation facts from the canonical migration."""
import json
import re
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
source = (root / 'aims/docs/migration_v5.41_work_item_deletion_evidence.sql').read_text()
ddl = source[source.index('CREATE TABLE'):].replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE')
ddl = ddl.replace('`work_item_deletion_evidence`', '`aims_work_item_deletion_evidence`')
ddl = ddl.replace('`uq_wide_', '`aims_uq_wide_').replace('`idx_wide_', '`aims_idx_wide_').strip().rstrip(';')
manifest = [{'Logical': 'work_item_deletion_evidence', 'Physical': 'aims_work_item_deletion_evidence',
             'DDL': ddl, 'Columns': re.findall(r'^  `([^`]+)` ', ddl, re.M)}]
output = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
target = root / 'data-runtime/internal/enterprise/domaininstall/deletion_evidence.json'
if '--check' in sys.argv:
    if target.read_text() != output:
        raise SystemExit('fixed evidence manifest drift')
else:
    target.write_text(output)
