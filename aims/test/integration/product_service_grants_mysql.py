"""Exercise actual generated SQL on an explicitly isolated Unix-socket MySQL."""
import os
from pathlib import Path
import shutil
import subprocess
import uuid

root = Path(__file__).resolve().parents[3]
socket = os.environ.get('HZY_PRODUCT_CENTER_TEST_SOCKET', '')
if not socket.startswith('/tmp/hzy-product-center.') or Path(socket).name != 'mysql.sock':
    raise SystemExit('HZY_PRODUCT_CENTER_TEST_SOCKET must name a dedicated test socket')
mysql = shutil.which('mysql') or '/usr/local/mysql/bin/mysql'
name = 'hzy_pc_grants_' + uuid.uuid4().hex
args = [mysql, '--no-defaults', '--socket=' + socket, '-u', 'root', '--batch', '--skip-column-names']


def sql(statement, database=True, force=False):
    result = subprocess.run(args + (['--force'] if force else []) + ([name] if database else []),
                            input=statement, text=True, capture_output=True)
    if result.returncode and not force:
        raise AssertionError(result.stderr)
    return result.stdout.strip().splitlines()


seed = (root / 'console/docs/sql/Console-SQL-Seed-product-center-20260907.sql').read_text()
verify = (root / 'console/docs/sql/Console-SQL-Verify-product-center-20260907.sql').read_text()
sql('CREATE DATABASE ' + name, database=False)
try:
    # Relevant Console columns and uniqueness; no credential secret is required
    # or loaded by either the seed or verifier.
    sql('''CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(128) UNIQUE,app_code VARCHAR(64),status VARCHAR(32),current_credential_id BIGINT);
CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,status VARCHAR(32),expires_at DATETIME);
CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(32),scope_json JSON,status VARCHAR(32),created_at DATETIME,updated_at DATETIME,UNIQUE(service_client_id,resource_code,action));''')
    missing = sql(verify)
    assert len(missing) == 236 and all('FAIL: missing client' in line for line in missing)
    sql(seed, force=True)
    assert sql('SELECT COUNT(*) FROM service_client_grants') == ['0']
    sql("""INSERT INTO service_clients VALUES (1,'aims.runtime','aims','active',1),(2,'assets.runtime','assets','active',2),(3,'aims.unrelated','aims','active',3),(4,'codocs.runtime','codocs','active',4),(5,'altoc.runtime','altoc','active',5),(6,'finance.runtime','finance','active',6);
INSERT INTO service_client_credentials VALUES (1,1,'active',NULL),(2,2,'active',NULL),(3,3,'active',NULL),(4,4,'active',NULL),(5,5,'active',NULL),(6,6,'active',NULL);""")
    sql(seed)
    sql(seed)
    assert sql('SELECT COUNT(*) FROM service_client_grants') == ['218']
    assert sql('SELECT COUNT(*) FROM service_client_grants WHERE service_client_id=3') == ['0']
    results = sql(verify)
    assert sum(line.endswith('PASS') for line in results) == 218
    assert sum('FAIL: missing/inactive exact grant' in line for line in results) == 18
    # Existing transport prerequisites are verified but not silently granted.
    for audience in ['data-runtime', 'tenant-runtime']:
        for client, app, actions in [(1, 'aims', ['read', 'write']), (2, 'assets', ['read']), (4, 'codocs', ['read', 'write']), (5, 'altoc', ['read', 'write']), (6, 'finance', ['read', 'write'])]:
            for action in actions:
                sql(f"INSERT INTO service_client_grants(service_client_id,resource_code,action,status) VALUES ({client},'{audience}:{app}','{action}','active')")
    assert all(line.endswith('PASS') for line in sql(verify))
    sql("UPDATE service_client_credentials SET status='inactive' WHERE id=6")
    assert sum('FAIL: current credential' in line for line in sql(verify)) == 11
    sql('DELETE FROM service_client_grants')
    sql(seed, force=True)
    assert sql('SELECT COUNT(*) FROM service_client_grants') == ['0']
    sql("UPDATE service_client_credentials SET status='active' WHERE id=6")
    sql(seed)
    # An invalid feedback source credential must gate the entire seed as well.
    sql("UPDATE service_client_credentials SET status='inactive' WHERE id=5")
    assert sum('FAIL: current credential' in line for line in sql(verify)) == 13
    sql('DELETE FROM service_client_grants')
    sql(seed, force=True)
    assert sql('SELECT COUNT(*) FROM service_client_grants') == ['0']
    sql("UPDATE service_client_credentials SET status='active' WHERE id=5")
    sql(seed)
    # Codocs credential health gates the complete install, including AIMS grants.
    sql("UPDATE service_client_credentials SET status='inactive' WHERE id=4")
    assert sum('FAIL: current credential' in line for line in sql(verify)) == 8
    sql('DELETE FROM service_client_grants')
    sql(seed, force=True)
    assert sql('SELECT COUNT(*) FROM service_client_grants') == ['0']
    sql("UPDATE service_client_credentials SET status='active' WHERE id=4")
    sql(seed)
    for audience in ['data-runtime', 'tenant-runtime']:
        for client, app, actions in [(1, 'aims', ['read', 'write']), (2, 'assets', ['read']), (4, 'codocs', ['read', 'write']), (5, 'altoc', ['read', 'write']), (6, 'finance', ['read', 'write'])]:
            for action in actions:
                sql(f"INSERT INTO service_client_grants(service_client_id,resource_code,action,status) VALUES ({client},'{audience}:{app}','{action}','active')")
    sql("UPDATE service_client_grants SET status='inactive' WHERE resource_code='data-runtime:aims:products' AND action='onboard'")
    assert sum('FAIL:' in line for line in sql(verify)) == 1
    sql(seed)
    assert all(line.endswith('PASS') for line in sql(verify))
    sql("UPDATE service_client_credentials SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=1")
    expired = sql(verify)
    assert sum('FAIL: current credential' in line for line in expired) == 195
    assert sum(line.endswith('PASS') for line in expired) == 41
    sql('DELETE FROM service_client_grants')
    sql(seed, force=True)
    assert sql('SELECT COUNT(*) FROM service_client_grants') == ['0'], 'failed guard must prevent grants even with mysql --force'
    print('PASS: 236 exact requirements; idempotent seed, absent clients, decoy client, transport prerequisites, inactive grants and expired credentials')
finally:
    sql('DROP DATABASE ' + name, database=False)
