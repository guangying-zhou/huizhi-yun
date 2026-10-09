#!/usr/bin/env python3
"""Reviewed supplemental WizBiz pipeline; protected parameters only, no secrets in output."""
import os,sys,json,pathlib,hashlib,subprocess,plistlib,shutil
os.umask(0o077)
def read(p):
 p=pathlib.Path(p);assert p.stat().st_mode&0o077==0,'protected_file_required';return json.loads(p.read_text())
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def run(p):
 out=pathlib.Path(p['output']);out.mkdir(mode=0o700,exist_ok=False)
 assert p['toolSha256']==sha(p['tool']) and p['runnerSha256']==sha(__file__),'artifact_sha_mismatch'
 profile=read(p['profile']);port=profile['target']['port'];assert port in (3306,3320),'target_port'
 assert p['rollbackOnSuccess']==(port==3320),'rollback_mode'
 env=dict(os.environ);pe=plistlib.loads(pathlib.Path(p['runtimePlist']).read_bytes()).get('EnvironmentVariables',{})
 for k in ['HZY_CONSOLE_VAULT_MASTER_KEY','HZY_CONSOLE_VAULT_MASTER_KEY_FILE','HZY_DATA_RUNTIME_CONFIG_DIR']:
  env.pop(k,None)
  if k in pe:env[k]=pe[k]
 for name,b in p['backups'].items():
  v=read(b['verified']);assert v['bytes']>0 and v['encryptedSha256']==sha(b['encrypted']),'backup_integrity'
 assert shutil.disk_usage(out).free>=20*(1<<30),'disk_space'
 common=['--profile',p['profile'],'--snapshot-manifest',p['manifest'],'--stage-receipt',p['stageReceipt'],'--identity-confirmed',p['identities'],'--plan',p['mainPlan'],'--followup-audit',p['audit']]
 if p.get('baselineConfig'):common+=['--baseline-runtime-config',p['baselineConfig']]
 calls={}
 def call(mode,extra):
  assert shutil.disk_usage(out).free>=20*(1<<30),'disk_space'
  calls[mode]=calls.get(mode,0)+1
  leaf=mode if calls[mode]==1 else mode+'-'+str(calls[mode])
  dest=out/(leaf+'.json');log=out/(leaf+'.log')
  with log.open('xb') as f:z=subprocess.run([p['tool'],'--mode',mode,*common,*extra,'--out',str(dest)],env=env,stdout=f,stderr=f)
  assert z.returncode==0,mode+'_failed'
  result=read(dest);print(mode+' PASS',flush=True);return result
 vp=call('vault-upgrade-plan',['--vault-upgrade-approval',p['approval']]);assert vp['trim_count']==p['expectedTrimCount']==1,'trim_count_mismatch';vargs=['--vault-upgrade-plan',str(out/'vault-upgrade-plan.json'),'--review-hash',vp['reviewHash']]
 call('vault-upgrade-apply',vargs);vr=call('vault-upgrade-verify',vargs)
 oargs=['--opening-confirmation',p['confirmation']]
 op=call('opening-plan',oargs);oargs+=['--opening-plan',str(out/'opening-plan.json'),'--review-hash',op['reviewHash']]
 call('opening-apply',oargs);orr=call('opening-verify',oargs)
 if p['rollbackOnSuccess']:
  call('opening-rollback',oargs);call('vault-upgrade-rollback',vargs);call('vault-upgrade-verify',vargs)
 result={'status':'verified','vaultReviewHash':vp['reviewHash'],'openingReviewHash':op['reviewHash'],'accounts':len(vp['rows']),'contracts':len(op['rows']),'openingTotal':op['total'],'rollback':p['rollbackOnSuccess'],'toolSha256':p['toolSha256'],'runnerSha256':p['runnerSha256']}
 (out/'success.json').write_text(json.dumps(result));print(json.dumps(result),flush=True)
if __name__=='__main__':
 try:run(read(sys.argv[1]))
 except Exception as e:
  # Never expose external driver, subprocess, configuration or source values.
  code=str(e);allowed=code if code.endswith('_failed') or code in ('protected_file_required','artifact_sha_mismatch','target_port','rollback_mode','backup_integrity','disk_space','trim_count_mismatch') else 'followup_failed'
  print(allowed,file=sys.stderr);sys.exit(1)
