// Candidate only: approved session supplied by protected file, never argv/header logs.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const pin='930c5ede7083664353acf871b3e8ef4173c45afd'
const base='/api/platform/ops/applications/'
const dir=process.env.ATTEMPT,source=process.env.SOURCE,mode=process.argv[2]
const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2),{mode:0o600,flag:'wx'})
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name)))
const normalize=m=>{const n={...m};delete n.version;delete n.displayVersion;return n}
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
try {
 assert.equal(process.env.APF_RELEASE_APPROVAL,'platform-930c5ede-C000001-test')
 assert.equal(execFileSync('hostname',{encoding:'utf8'}).trim(),'iZcqwiqyhp9u8rZ')
 assert.equal(JSON.parse(fs.readFileSync(process.env.CANDIDATE_ARTIFACT_MANIFEST)).commit,pin)
 assert.equal(fs.statSync(process.env.PLATFORM_SESSION_FILE).mode&0o777,0o600)
 const headers=JSON.parse(fs.readFileSync(process.env.PLATFORM_SESSION_FILE))
 // File holds an approved operator's current session headers and tenant context, not a service-token bypass.
 assert.equal(headers['x-hzy-tenant-code'],'C000001')
 const request=async(p,body)=>{
  const r=await fetch('http://127.0.0.1:3011'+p,{method:body?'POST':'GET',headers:{...headers,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(90000)})
  if(!r.ok){await r.body?.cancel();throw Error('request failed')}
  const j=await r.json();assert.equal(j.code,0);return j.data
 }
 const catalog=async app=>(await request(base+app+'/manifests')).items
 const latestCatalog=async app=>{
  const apps=(await request('/api/platform/ops/applications?'+new URLSearchParams({appCode:app,page:'1',pageSize:'20'}))).items.filter(x=>x.appCode===app)
  assert.equal(apps.length,1)
  const latest=(await catalog(app)).filter(x=>x.id===apps[0].latestManifestId)
  assert.equal(latest.length,1)
  return latest
 }
 const resign=()=>request('/api/platform/ops/tenants/C000001/bundles',{environment:'test',includePayload:false})
 const imports=['people','altoc','finance']
 if(mode==='preview') {
  for(const app of imports){
   const latest=await latestCatalog(app)
   assert.equal(latest.length,1);assert.ok(latest[0].releaseVersions.length>0)
   save(app+'-before.json',latest[0])
   const preview=await request('/api/platform/ops/app-manifest-imports/preview?'+new URLSearchParams({repoUrl:process.env.APP_REPO_URL,ref:pin,manifestPath:app+'/app.manifest.json'}))
   assert.equal(preview.gitlab.commitSha,pin)
   assert.equal(stable(normalize(preview.manifestJson)),stable(normalize(JSON.parse(fs.readFileSync(path.join(source,app,'app.manifest.json'))))))
   save(app+'-preview.json',preview)
  }
 }else if(mode==='import') {
  // Separate human-approved diff gate after all previews; no auto-import from preview alone.
  assert.equal(read('preview-approved.json').commit,pin)
  const started=[]
  try {
   for(const app of imports){
    const expected=read(app+'-preview.json');started.push(app) // response loss may already have committed
    const result=await request(base+app+'/manifests/import-from-gitlab',{version:'v0.0.0-apf-930c5ede',ref:pin,commitSha:pin,manifestPath:app+'/app.manifest.json'})
    save(app+'-import.json',result)
    const latest=await latestCatalog(app)
    assert.equal(latest.length,1);assert.equal(stable(normalize(latest[0].manifestJson)),stable(normalize(expected.manifestJson)))
   }
  }catch{
   // Restore previous directory through governance, never restore signed watermarks via raw SQL.
   for(const app of started.reverse()){
    const old=read(app+'-before.json')
    // Finance explicit [] retracts newly owned defaults; omission intentionally preserves them.
    const oldManifest=structuredClone(old.manifestJson)
    if(app==='finance')for(const role of oldManifest.recommendedRoles||[])role.defaultScopes=[]
    await request(base+app+'/manifests',{version:'v0.0.0-apf-rollback-930c5ede',manifestJson:oldManifest,sourceType:'admin_ui',reviewComment:'Approved APF candidate rollback: retract only owned defaults'})
   }
   save('rollback-test-bundle.json',await resign())
   throw Error('import failed; previous catalog recovered, verify scopes and test revocation before code rollback')
  }
 }else if(mode==='resign') {
  assert.equal(read('roles-readback-approved.json').tenant,'C000001')
  assert.equal(read('roles-readback-approved.json').environment,'test')
  for(const app of imports)assert.ok(fs.existsSync(path.join(dir,app+'-import.json')))
  const result=await resign();assert.equal(result.tenantCode,'C000001');assert.equal(result.environment,'test')
  save('test-bundle.json',result)
 }else if(mode==='readback') {
  for(const app of imports){
   const latest=await latestCatalog(app)
   assert.equal(latest.length,1);assert.equal(stable(normalize(latest[0].manifestJson)),stable(normalize(read(app+'-preview.json').manifestJson)))
  }
  assert.ok(read('test-bundle.json').policyRevision)
 }else throw Error('invalid stage')
 console.log(`${mode}: PASS; details retained privately`)
}catch{console.error('API stage stopped; no raw response logged. Review private checkpoint; do not retry with a new intent.');process.exitCode=1}
