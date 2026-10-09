// Exact test-only cleanup; preserve synthetic users and recoverable snapshots.
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
try {
 const run=(cmd,args,input)=>execFileSync(cmd,args,{input,stdio:['pipe','pipe','pipe']}).toString().trim()
 if(run('hostname',[])!=='iZcqwiqyhp9u8rZ'||process.argv[2]!=='--execute')throw Error('guard')
 const c=JSON.parse(fs.readFileSync('/wiztek/hzy-test/runtime/config.json'))
 if(c.tenant!=='C000001'||c.apps.console.db.database!=='hzy_console_test_20260905'||c.deploymentBindings.console!=='wiztek-test-console')throw Error('binding')
 const sql=s=>run('docker',['exec','-i','hzy-test-mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names hzy_console_test_20260905'],s)
 const dept=sql("SELECT JSON_OBJECT('code',dept_code,'name',dept_name,'status',status) FROM directory_departments WHERE dept_code='TEST-RD';")
 const users=sql("SELECT uid FROM directory_users WHERE primary_dept_code='TEST-RD';")
 const members=sql("SELECT uid FROM directory_user_departments WHERE dept_code='TEST-RD';")
 const children=sql("SELECT COUNT(*) FROM directory_departments WHERE parent_dept_code='TEST-RD' AND status<>'deleted';")
 if(!dept||JSON.parse(dept).status!=='active'||users!=='test-user-001'||members!=='test-user-001'||children!=='0')throw Error('scope')
 const backup=fs.mkdtempSync('/wiztek/hzy-test/backups/remove-test-rd-');fs.chmodSync(backup,0o700)
 const snapshot=sql("SELECT JSON_OBJECT('uid',uid,'dept',primary_dept_code) FROM directory_users WHERE uid='test-user-001'; SELECT JSON_OBJECT('uid',uid,'dept',dept_code,'primary',is_primary,'status',status) FROM directory_user_departments WHERE dept_code='TEST-RD';")
 fs.writeFileSync(`${backup}/before.jsonl`,dept+'\n'+snapshot,{mode:0o600,flag:'wx'})
 sql("START TRANSACTION; UPDATE directory_user_departments SET status='inactive',is_primary=0 WHERE dept_code='TEST-RD' AND uid='test-user-001'; UPDATE directory_users SET primary_dept_code=NULL WHERE uid='test-user-001' AND primary_dept_code='TEST-RD'; UPDATE directory_departments SET status='deleted',updated_at=UTC_TIMESTAMP() WHERE dept_code='TEST-RD' AND status='active'; COMMIT;")
 console.log(JSON.stringify({department:'TEST-RD',status:sql("SELECT status FROM directory_departments WHERE dept_code='TEST-RD';"),userPreserved:true,backup}))
}catch{console.error('Synthetic department cleanup stopped; sensitive diagnostics suppressed.');process.exitCode=1}
