#!/usr/bin/env python3
"""Same offline W1/account/migration orchestration for copy and hzy0.
All connections and paths are protected target parameters. Never print SQL,
credentials, source rows or driver errors. Failure restores the target backup.
"""
import pathlib,json,os,sys,subprocess,socket,hashlib,secrets,re,shutil,plistlib,stat
os.umask(0o077)
ORDER=['w1-finance-legal-entity','w1-finance-balance-entry','w1-finance-balance-columns','finance-bank-account-columns','w1-altoc-customer-columns','w1-altoc-contact-columns','w1-altoc-customer-snapshot','w1-altoc-contract-columns','w1-altoc-contract-snapshot','w1-migration-ledger']
def read(p):
 p=pathlib.Path(p);s=p.lstat();assert stat.S_ISREG(s.st_mode)
 assert not p.is_symlink() and s.st_uid==os.getuid() and s.st_mode&0o777==0o600
 return json.loads(p.read_text())
def write(p,obj):
 with pathlib.Path(p).open('x') as f:json.dump(obj,f,indent=2)
 pathlib.Path(p).chmod(0o600)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
class Runner:
 def __init__(self,p):
  self.p=p;self.out=pathlib.Path(p['output']);self.out.mkdir(mode=0o700)
  self.cfg=read(p['baselineConfig']);self.profile=read(p['templateProfile']);self.admin=read(p['admin']);self.env=dict(os.environ);self.created=[];self.plan=None;self.grantsBefore=None
  assert self.admin['host']=='127.0.0.1' and self.admin['port']==p['port'] and p['port'] in [3306,3320]
  assert self.cfg['enterprise']['db']['port']==p['port'] and self.cfg['enterprise']['instanceId']==p['instanceId']
  assert self.cfg['tenant']=='C000001' and self.cfg['enterprise']['environment']=='test' and self.cfg['enterprise']['generation']>0
  assert p['port']==3320 if p['rollbackOnSuccess'] else p['port']==3306
  for item in p['artifacts']:
   assert sha(item['path'])==item['sha256'],'artifact_hash_mismatch'
  assert any(pathlib.Path(x['path']).resolve()==pathlib.Path(__file__).resolve() for x in p['artifacts'])
  write(self.out/'artifact-sha.json',p['artifacts'])
  if p['port']==3320:
   self.env['HZY_CONSOLE_VAULT_MASTER_KEY']='isolated-breakglass-vault-key'
   for k in ['HZY_CONSOLE_VAULT_MASTER_KEY_FILE','HZY_DATA_RUNTIME_CONFIG_DIR']:self.env.pop(k,None)
  else:
   e=plistlib.loads(pathlib.Path(p['runtimePlist']).read_bytes())['EnvironmentVariables']
   self.env.pop('HZY_CONSOLE_VAULT_MASTER_KEY',None)
   for k in ['HZY_CONSOLE_VAULT_MASTER_KEY_FILE','HZY_DATA_RUNTIME_CONFIG_DIR']:
    if k in e:self.env[k]=e[k]
  self.defaults=self.out/'admin.cnf';a=self.admin
  lines=['[client]','protocol='+('SOCKET' if a.get('socket') else 'TCP'),'user='+a['user']]
  if a.get('socket'):lines+=['socket='+a['socket']]
  else:lines+=['host=127.0.0.1','port='+str(a['port'])]
  if a.get('password'):lines+=['password="'+a['password'].replace('\\','\\\\').replace('"','\\"')+'"']
  self.defaults.write_text('\n'.join(lines)+'\n');self.defaults.chmod(0o600)
  identity=self.sql('SELECT @@port,@@server_uuid;').strip().split('\t');assert identity==[str(p['port']),p['instanceId']]
  self.baseCounts=self.counts();write(self.out/'baseline-counts.json',self.baseCounts)
 def sql(self,q):
  z=subprocess.run(['mysql','--defaults-extra-file='+str(self.defaults),'-N','-B'],input=q.encode(),capture_output=True)
  assert z.returncode==0,'target_sql_failed';return z.stdout.decode()
 def cmd(self,args,name):
  with (self.out/(name+'.log')).open('wb') as f:z=subprocess.run(args,stdout=f,stderr=f,env=self.env)
  assert z.returncode==0,name+'_failed'
 def counts(self):
  result={}
  for db in [self.cfg['enterprise']['db']['database'],self.cfg['apps']['console']['db']['database']]:
   assert re.fullmatch('[A-Za-z0-9_]+',db)
   tables=self.sql("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='"+db+"' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;").splitlines()
   result[db]={t:int(self.sql('SELECT COUNT(*) FROM `'+db+'`.`'+t+'`;').strip()) for t in tables}
  return result
 def allgrants(self):
  result=[]
  for line in self.sql('SELECT User,Host FROM mysql.user ORDER BY User,Host;').splitlines():
   u,h=line.split('\t');assert re.fullmatch('[A-Za-z0-9_.-]+',u) and re.fullmatch('[A-Za-z0-9_.:%-]+',h)
   result.append({'user':u,'host':h,'grants':sorted(self.sql("SHOW GRANTS FOR '"+u+"'@'"+h+"';").splitlines())})
  return result
 def encrypt(self,name,value):
  data=json.dumps(value).encode();dest=self.out/(name+'.json.enc');key=self.p['backupKey']
  z=subprocess.run(['openssl','enc','-aes-256-cbc','-salt','-pbkdf2','-iter','200000','-out',str(dest),'-pass','file:'+key],input=data,capture_output=True);assert z.returncode==0
  z=subprocess.run(['openssl','enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-in',str(dest),'-pass','file:'+key],capture_output=True);assert z.returncode==0 and z.stdout==data
 def disk(self,phase):
  results=[]
  for path in self.p['diskPaths']:
   a=['node',self.p['diskGate'],'--path',path,'--backup-bytes',str(4<<30),'--staging-bytes',str(4<<30),'--log-bytes',str(16<<30),'--safety-bytes',str(8<<30)]
   z=subprocess.run(a,capture_output=True);assert z.returncode==0,'disk_gate_failed';results.append(json.loads(z.stdout))
  write(self.out/('disk-'+phase+'.json'),results)
 def stopped(self):
  host,port=self.profile['runtime']['listen'].split(':');assert host=='127.0.0.1'
  with socket.socket() as s:assert s.connect_ex((host,int(port)))!=0,'runtime_still_listening'
 def account(self,kind,plan):
  user='hzy_wizbiz_migrate' if kind=='target' else 'hzy_wizbiz_directory_ro';db=self.profile['database'] if kind=='target' else self.profile['consoleDatabase']
  assert not self.sql("SELECT User FROM mysql.user WHERE User='"+user+"';").strip(),'account_exists'
  before=self.allgrants();self.encrypt(kind+'-grants-before',before)
  pw=secrets.token_hex(40);conn={'host':'127.0.0.1','port':self.p['port'],'user':user,'password':pw,'database':db};write(self.out/(kind+'-account.json'),conn)
  self.sql("CREATE USER '"+user+"'@'127.0.0.1' IDENTIFIED BY '"+pw+"';");self.created.append(user)
  for stmt in plan:self.sql(stmt)
  after=self.allgrants();assert [r for r in after if r['user']!=user]==before
  raw=next(r['grants'] for r in after if r['user']==user and r['host']=='127.0.0.1')
  write(self.out/(kind+'-show-grants.json'),raw)
  if kind=='target':self.cmd([self.p['tools']['grants'],'--profile',str(self.out/'grant-profile.json'),'--show-grants',str(self.out/(kind+'-show-grants.json')),'--out',str(self.out/'target-grants-verified.json')],'target-account-verify')
  else:
   expected=sorted(["GRANT USAGE ON *.* TO `"+user+"`@`127.0.0.1`"]+[stmt[:-1].replace("'"+user+"'@'127.0.0.1'","`"+user+"`@`127.0.0.1`") for stmt in plan]);assert raw==expected
  self.encrypt(kind+'-grants-after',after);self.profile[kind]=conn
 def run(self):
  self.disk('before-w1');self.stopped();assert read(self.p['transformAudit'])['ready']
  self.profile['runtimeConfig']=self.p['baselineConfig'];self.profile['instanceId']=self.p['instanceId'];self.profile['target']={'host':'127.0.0.1','port':self.p['port'],'user':'hzy_wizbiz_migrate','database':self.profile['database']}
  self.profile['vaultWrite']='synthetic';write(self.out/'grant-profile.json',self.profile)
  self.cmd([self.p['tools']['grants'],'--profile',str(self.out/'grant-profile.json'),'--out',str(self.out/'target-grants-candidate.json')],'grant-candidate')
  approved=[s for s in pathlib.Path(self.p['approvedTarget']).read_text().splitlines() if s.startswith('GRANT ')];candidate=read(self.out/'target-grants-candidate.json');assert len(approved)==248 and candidate['grants']==approved
  db=self.profile['consoleDatabase'];directory=["GRANT SELECT ON `"+db+"`.`"+t+"` TO 'hzy_wizbiz_directory_ro'@'127.0.0.1';" for t in ['directory_users','directory_user_departments']]
  assert directory==[s for s in pathlib.Path(self.p['approvedDirectory']).read_text().splitlines() if s.startswith('GRANT ')]
  self.grantsBefore=self.allgrants();self.encrypt('all-grants-before',self.grantsBefore)
  prev=pathlib.Path(self.p['baselineConfig']);w1=[]
  for subset in ORDER:
   d=self.out/subset;d.mkdir(mode=0o700)
   a=['--subset',subset,'--config',str(prev),'--migration-db-config',self.p['installer'],'--proposed-config',str(d/'proposed.json'),'--plan',str(d/'plan.json')]
   if self.p.get('installerProfile'):a+=['--profile',self.p['installerProfile']]
   self.cmd([self.p['tools']['installer'],'--mode','plan',*a],subset+'-plan');plan=read(d/'plan.json');rh=plan['ReviewHash'];assert plan['Subset']==subset and len(rh)==64
   for mode in ['apply','verify']:self.cmd([self.p['tools']['installer'],'--mode',mode,*a,'--review-hash',rh,'--receipt',str(d/'receipt.json')],subset+'-'+mode)
   w1.append({'subset':subset,'reviewHash':rh});prev=d/'proposed.json';print(subset+' PASS',flush=True)
  write(self.out/'w1-review-hashes.json',w1)
  shutil.copyfile(prev,self.p['liveConfig']);pathlib.Path(self.p['liveConfig']).chmod(0o600)
  self.profile['runtimeConfig']=self.p['liveConfig']
  self.account('target',approved);self.account('directory',directory);write(self.out/'migration-profile.json',self.profile)
  self.cmd(['node',self.p['preflight'],'--migration-db-config',self.p['installer'],'--wizbiz-profile',str(self.out/'migration-profile.json'),'--snapshot-manifest',self.p['manifest'],'--preflight-bin',self.p['tools']['preflight'],'--phase','migration'],'full-identity-preflight')
  assert json.loads((self.out/'full-identity-preflight.log').read_text())['ready']
  common=['--profile',str(self.out/'migration-profile.json'),'--snapshot-manifest',self.p['manifest'],'--stage-receipt',self.p['stageReceipt'],'--identity-confirmed',self.p['identities']]
  self.cmd([self.p['tools']['migrate'],'--mode','plan',*common,'--out',str(self.out/'migration-plan.json')],'migration-plan');self.plan=read(self.out/'migration-plan.json')
  print('plan PASS reviewHash='+self.plan['reviewHash'],flush=True)
  common+=['--plan',str(self.out/'migration-plan.json'),'--review-hash',self.plan['reviewHash']]
  self.disk('pre-apply');self.stopped()
  for mode in ['apply','verify']:
   self.cmd([self.p['tools']['migrate'],'--mode',mode,*common,'--out',str(self.out/('migration-'+mode+'-receipt.json'))],'migration-'+mode);print(mode+' PASS',flush=True)
  v=read(self.out/'migration-verify-receipt.json');assert v['differences']==[] and v['orphanVaultCount']==0
  write(self.out/'success.json',{'status':'verified','reviewHash':self.plan['reviewHash'],'verify':v,'w1':w1,'artifacts':self.p['artifacts']})
  if self.p['rollbackOnSuccess']:self.rollback()
 def rollback(self):
  self.stopped()
  if self.plan:
   a=['--profile',str(self.out/'migration-profile.json'),'--snapshot-manifest',self.p['manifest'],'--stage-receipt',self.p['stageReceipt'],'--identity-confirmed',self.p['identities'],'--plan',str(self.out/'migration-plan.json'),'--review-hash',self.plan['reviewHash']]
   self.cmd([self.p['tools']['migrate'],'--mode','rollback',*a,'--out',str(self.out/'migration-rollback-receipt.json')],'migration-rollback');r=read(self.out/'migration-rollback-receipt.json');assert r['status']=='rolled_back' and r['retained']==0
  # Restores the reviewed backup to remove W1 and retained immutable ledger rows.
  for name,db in [('enterprise',self.cfg['enterprise']['db']['database']),('console',self.cfg['apps']['console']['db']['database'])]:
   self.sql('DROP DATABASE `'+db+'`;CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;')
   with (self.out/(name+'-restore.log')).open('wb') as err:
    op=subprocess.Popen(['openssl','enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-in',self.p['backups'][name],'-pass','file:'+self.p['backupKey']],stdout=subprocess.PIPE,stderr=err)
    gz=subprocess.Popen(['gzip','-dc'],stdin=op.stdout,stdout=subprocess.PIPE,stderr=err);op.stdout.close()
    my=subprocess.Popen(['mysql','--defaults-extra-file='+str(self.defaults),'--binary-mode','--database='+db],stdin=gz.stdout,stdout=err,stderr=err);gz.stdout.close();assert [my.wait(),gz.wait(),op.wait()]==[0,0,0]
  for user in reversed(self.created):self.sql("DROP USER '"+user+"'@'127.0.0.1';")
  if self.grantsBefore is not None:assert self.allgrants()==self.grantsBefore
  assert self.counts()==self.baseCounts,'restored_baseline_mismatch'
  shutil.copyfile(self.p['baselineConfig'],self.p['liveConfig']);pathlib.Path(self.p['liveConfig']).chmod(0o600)
  write(self.out/'rollback-baseline.json',{'ready':True,'retained':0,'countsEqual':True,'grantsEqual':True})
  print('rollback + original schema/counts/grants PASS',flush=True)
 def close(self):self.defaults.unlink(missing_ok=True)
def main():
 runner=None
 try:
  p=read(sys.argv[1]);runner=Runner(p);runner.run();print('shared orchestration PASS',flush=True)
 except BaseException as e:
  code=str(e) if re.fullmatch('[a-z0-9_.-]+',str(e)) else 'guard_failed'
  print('shared orchestration failed class='+type(e).__name__+' code='+code,flush=True)
  if runner:
   try:runner.rollback()
   except BaseException:print('rollback blocked; keep Runtime stopped',flush=True)
  return 1
 finally:
  if runner:runner.close()
 return 0
if __name__=='__main__':sys.exit(main())
