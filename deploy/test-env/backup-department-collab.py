import os,pathlib,subprocess,tarfile,io,hashlib,json,plistlib,datetime
os.umask(0o077);H=pathlib.Path.home();R=H/'Library/Application Support/HuizhiYun/test-runtime';ROOT=H/'orca/huizhiyun';PROFILE=H/'.config/huizhi-yun/hzy0/profile.json';PLIST=H/'Library/LaunchAgents/cn.wiztek.hzy-test-runtime.plist'
varsfile=R/'database-backup/local-c000001-rollout-20260928T113855Z/vars.env'
line=next(x for x in varsfile.read_text().splitlines() if x.startswith('KEY_PATH='));key=pathlib.Path(line.split('=',1)[1].strip().strip('\"\''));assert key.is_file()
profile=json.loads(PROFILE.read_text());config=pathlib.Path(plistlib.loads(PLIST.read_bytes())['EnvironmentVariables']['HZY_DATA_RUNTIME_CONFIG']);assert config.is_file()
rows=subprocess.check_output([str(H/'Library/pnpm/pm2'),'jlist'],env=dict(os.environ,PM2_HOME=profile['processManagement']['pm2Home']))
expected={'hzy0-'+x for x in ['gateway','enterprise','codocs-editor','console','collab','workflow','aims']};pms=[x for x in json.loads(rows) if x['name'] in expected];assert len(pms)==7 and all(x['pm2_env']['status']=='online' for x in pms)
# Resolve each protected configuration from its actual running PM2 candidate.
roots = {}
for process in pms:
    env = process['pm2_env']
    root = pathlib.Path(env['pm_cwd']).resolve(strict=True)
    assert (root/'deploy/test-env/local-enterprise/run-process.mjs').is_file(), 'running candidate incomplete'
    roots[process['name']] = root
protected = []
for app, file in [('gateway','wrangler.json'),('gateway','secrets.json'),('aims','secrets.json'),('codocs','wrangler.json'),('codocs','secrets.json'),('console','secrets.json')]:
    process_name = 'hzy0-codocs-editor' if app == 'codocs' else 'hzy0-'+app
    p = roots[process_name]/'deploy/test-env/.cloudflare-workers'/app/file
    assert p.is_file() and p.stat().st_mode & 0o777 == 0o600 and p.stat().st_uid == os.getuid(), 'protected candidate configuration missing or unsafe'
    protected.append((p, app, file))
assert __import__('shutil').disk_usage(R).free>=20*1024**3
back=R/'domain-backups'/('department-default-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));back.mkdir(mode=0o700)
buf=io.BytesIO()
with tarfile.open(fileobj=buf,mode='w') as tar:
 for p in [R/'hzy-data-runtime',config,PLIST,PROFILE.parent]:tar.add(p,arcname=str(p.relative_to(H)))
 for p,app,file in protected:
  tar.add(p,arcname='candidate-protected/'+app+'/'+file)
 info=tarfile.TarInfo('pm2-jlist.json');info.size=len(rows);info.mode=0o600;tar.addfile(info,io.BytesIO(rows))
plain=buf.getvalue();options=['openssl','enc','-aes-256-cbc','-salt','-pbkdf2','-iter','200000','-pass','file:'+str(key)]
enc=subprocess.check_output(options,input=plain);out=back/'runtime-config-profile-pm2.tar.enc';out.write_bytes(enc);out.chmod(0o600)
restored=subprocess.check_output(options+['-d'],input=enc);assert hashlib.sha256(restored).digest()==hashlib.sha256(plain).digest()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
meta={'directory':str(back),'backup':str(out),'decryptedSha256':hashlib.sha256(plain).hexdigest(),'encryptedSha256':sha(out),'oldBinaryHash':sha(R/'hzy-data-runtime'),'profileHash':sha(PROFILE),'plistHash':sha(PLIST),'databaseWrite':False}
(ROOT/'department-default-backup.json').write_text(json.dumps(meta));print(json.dumps({'backup':str(out),'decryptionVerified':True,'processes':len(pms),'databaseWrite':False}))
