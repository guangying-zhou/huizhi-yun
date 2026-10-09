"""Generate the reviewed APF first-wave manifests; never execute SQL."""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/Enterprise-APF-Domain-Design.sql'
LEDGERS = ('integration_operation', 'integration_operation_attempt',
           'integration_operation_dead_letter_actionable', 'service_command_receipt')
CREATE = re.compile(r'^CREATE TABLE(?: IF NOT EXISTS)? `?(\w+)`? \(.*?^\) ENGINE=.*?;', re.M | re.S)
COLUMN = re.compile(r'^\s{2,}`?(\w+)`?\s+(?:BIGINT|INT|VARCHAR|CHAR|TEXT|LONGTEXT|MEDIUMTEXT|TINYINT|SMALLINT|DECIMAL|DATETIME|TIMESTAMP|DATE|JSON|ENUM|BOOLEAN|BOOL|DOUBLE|FLOAT|BINARY|VARBINARY)\b', re.M | re.I)


def manifests():
    source = SOURCE.read_text()
    sections = {
        'finance': source[:source.index('-- B1-A')],
        'altoc': source[source.index('-- B1-A'):source.index('-- B3-F')],
        'people': source[source.index('-- B2-P'):source.index('CREATE TABLE people_cost_snapshots')],
    }
    shared = {m[1]: m[0] for m in CREATE.finditer((ROOT / 'altoc/docs/altoc_schema.sql').read_text())}
    result = {}
    for domain, section in sections.items():
        tables = {m[1]: m[0] for m in CREATE.finditer(section)}
        # Fold the reviewed first-wave ALTER into the owning CREATE. Its FK
        # remains in the manifest/review hash, and dependency sorting includes it.
        for alter in re.finditer(r'^ALTER TABLE (\w+)\s+ADD (CONSTRAINT .*?);', section, re.M | re.S):
            name, constraint = alter.groups()
            if name not in tables:
                raise ValueError('ALTER target outside fixed installation set')
            tables[name] = tables[name].replace('\n) ENGINE=', ',\n    ' + constraint + '\n) ENGINE=')
        expected = {'finance': 9, 'altoc': 26, 'people': 6}[domain]
        if len(tables) != expected:
            raise ValueError(f'{domain}: reviewed first-wave set changed')
        for ledger in LEDGERS:
            ddl = shared[ledger]
            ddl = re.sub(r'^CREATE TABLE ' + ledger + r'\b', 'CREATE TABLE ' + domain + '_' + ledger, ddl)
            ddl = re.sub(r'REFERENCES\s+`?(\w+)`?', lambda m: 'REFERENCES `' + domain + '_' + m[1] + '`', ddl)
            ddl = re.sub(r'CONSTRAINT\s+(\w+)', lambda m: 'CONSTRAINT ' + domain + '_' + m[1], ddl)
            tables[domain + '_' + ledger] = ddl
        ordered, done = [], set()
        while len(done) < len(tables):
            progress = False
            for name in sorted(tables.keys() - done):
                ddl = tables[name]
                refs = set(re.findall(r'REFERENCES\s+`?(\w+)', ddl)) - {name}
                if not refs <= done:
                    continue
                logical = name[len(domain) + 1:] if name[len(domain) + 1:] in LEDGERS else name
                ordered.append({'Logical': logical, 'Physical': name, 'Columns': COLUMN.findall(ddl), 'DDL': ddl})
                done.add(name)
                progress = True
            if not progress:
                raise ValueError(f'{domain}: external FK or dependency cycle')
        result[domain] = ordered
    return result


if __name__ == '__main__':
    for domain, tables in manifests().items():
        target = ROOT / f'data-runtime/internal/enterprise/domaininstall/apf_{domain}.json'
        content = json.dumps(tables, ensure_ascii=False, indent=2) + '\n'
        if '--check' in sys.argv:
            if not target.exists() or target.read_text() != content:
                raise SystemExit(f'{domain}: APF manifest differs from reviewed SQL')
        else:
            target.write_text(content)
        canonical = ROOT / f'{domain}/docs/apf_m1_schema.sql'
        sql = '-- APF M1 candidate canonical; no history import, no compatibility views.\n' + '\n\n'.join(table['DDL'] for table in tables) + '\n'
        if '--check' in sys.argv:
            if not canonical.exists() or canonical.read_text() != sql:
                raise SystemExit(f'{domain}: candidate canonical differs')
        else:
            canonical.write_text(sql)
        print(f'APF {domain}: {len(tables)} tables, no views')
