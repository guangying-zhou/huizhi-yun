import importlib.util,json,plistlib,tempfile,pathlib,hashlib,unittest,contextlib,io
MODULE=pathlib.Path(__file__).with_name('run.py')
spec=importlib.util.spec_from_file_location('followup_runner',MODULE);runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
class RunnerTests(unittest.TestCase):
 def test_second_verify_preserves_first_receipt(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=pathlib.Path(tmp)
   def put(name,value):
    p=r/name;p.write_text(json.dumps(value));p.chmod(0o600);return str(p)
   tool=r/'fixture-tool.py';tool.write_text('''#!/usr/bin/env python3
import sys,json,os
os.umask(0o077)
a=sys.argv;mode=a[a.index('--mode')+1];out=a[a.index('--out')+1]
d={'status':'verified','reviewHash':'a'*64,'trim_count':1,'rows':[{}],'total':'1.00'}
with open(out,'x') as f:json.dump(d,f)
''');tool.chmod(0o700)
   profile=put('profile.json',{'target':{'port':3320}});pl=r/'runtime.plist';pl.write_bytes(plistlib.dumps({'EnvironmentVariables':{}}));pl.chmod(0o600)
   enc=r/'fixture.enc';enc.write_bytes(b'synthetic encrypted fixture');enc.chmod(0o600);digest=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest();verified=put('verified.json',{'bytes':1,'encryptedSha256':digest(enc)})
   p={'output':str(r/'output'),'profile':profile,'tool':str(tool),'toolSha256':digest(tool),'runnerSha256':digest(MODULE),'runtimePlist':str(pl),'rollbackOnSuccess':True,'expectedTrimCount':1,'backups':{'fixture':{'verified':verified,'encrypted':str(enc)}}}
   for k in ['manifest','stageReceipt','identities','mainPlan','audit','approval','confirmation']:p[k]='synthetic-fixture'
   with contextlib.redirect_stdout(io.StringIO()):runner.run(p)
   o=r/'output';self.assertTrue((o/'vault-upgrade-verify.json').exists());self.assertTrue((o/'vault-upgrade-verify-2.json').exists());self.assertEqual(json.loads((o/'success.json').read_text())['rollback'],True)
if __name__=='__main__':unittest.main()
