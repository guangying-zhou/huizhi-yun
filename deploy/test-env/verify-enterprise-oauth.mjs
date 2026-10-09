/** Real CF Gateway -> Console service binding -> customer Runtime OAuth probe.
 * No locally generated token, plaintext client secret, deployment or route write.
 * Protected existing Gateway credential is used only on its exact test origin.
 */
import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { enterprisePilot as p } from './enterprise-topology.mjs'
const root=resolve(import.meta.dirname,'../..')
async function main(){
 const mode=process.argv[2]||'--plan'
 const external=mode==='--execute-codocs'
 const audience=external?'codocs':'data-runtime'
 const selected=mode==='--execute-scopes'?process.argv.slice(3):[]
 if(!['--plan','--execute','--execute-all','--resume-all','--execute-scopes','--execute-codocs'].includes(mode)||(mode!=='--execute-scopes'&&process.argv.length>3)||(mode==='--execute-scopes'&&(!selected.length||new Set(selected).size!==selected.length)))throw Error('MODE_INVALID')
 if(mode==='--plan'){console.log(JSON.stringify({tenant:p.tenantCode,deployment:p.deploymentCode,endpoint:p.origin+'/oauth/token',scope:'aims:products:view',credential:'existing protected Gateway internal identity',signatureVerification:'stdin enterprise-test-credential --verify-token',configurationMutated:false}));return}
 const file=resolve(root,'deploy/test-env/.cloudflare-workers/gateway/secrets.json')
 if(statSync(file).mode&0o077)throw Error('CREDENTIAL_FILE_PERMISSIONS')
 const secrets=JSON.parse(readFileSync(file,'utf8')),registry=JSON.parse(secrets.HZY_TENANT_GATEWAY_REGISTRY_JSON||'{}')
 const tenant=registry.domains?.['hzy-test.huizhi.yun']
 if(tenant?.tenantCode!==p.tenantCode||tenant.environment!=='test'||tenant.apps?.console?.deploymentCode!==p.consoleDeployment||tenant.dataRuntime?.endpoint!==p.runtimeEndpoint)throw Error('REGISTRY_BINDING_MISMATCH')
 const key=secrets.HZY_CLOUDFLARE_INTERNAL_TOKEN||secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
 if(typeof key!=='string'||!key)throw Error('GATEWAY_CREDENTIAL_MISSING')
 const digestResponse=await fetch(p.origin+'/__test/registry-digest',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${key}`}})
 if(!digestResponse.ok)throw Error('REMOTE_REGISTRY_UNAVAILABLE')
 const live=await digestResponse.json()
 if(live.schema!=='test-registry-digest.v1'||live.tenant!==p.tenantCode||live.environment!=='test'||live.enterpriseDeployment!==p.deploymentCode)throw Error('REMOTE_REGISTRY_MISMATCH')
 const issue=async(scope,audience)=>fetch(p.origin+'/oauth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{'content-type':'application/x-www-form-urlencoded','x-hzy-gateway':'tenant-gateway','x-hzy-gateway-token':key,'x-hzy-app-code':'enterprise','x-hzy-tenant':p.tenantCode,'x-hzy-environment':'test','x-hzy-deployment':p.deploymentCode},body:new URLSearchParams({grant_type:'client_credentials',client_id:'enterprise.runtime',app_code:'enterprise',audience,scope,source_binding:'service-client-policy'})})
 const source=readFileSync(resolve(root,'foundation/server/utils/enterpriseRuntimeClient.ts'),'utf8')
 const capabilities=[...new Set([...source.matchAll(/capability:\s*'([^']+)'/g)].map(m=>m[1]))].sort()
 const allowlist=[...readFileSync(resolve(root,'data-runtime/cmd/enterprise-test-credential/scopes.go'),'utf8').matchAll(/"([^"]+)":\s*true/g)].map(m=>m[1]).sort()
 if(JSON.stringify(capabilities)!==JSON.stringify(allowlist)||!source.includes('scope: route.capability'))throw Error('CAPABILITY_CONTRACT_DRIFT')
 if(selected.some(scope=>!capabilities.includes(scope)))throw Error('SCOPE_NOT_REGISTERED_IN_CONTRACT')
 const all=mode==='--execute-all'||mode==='--resume-all'
 const checkpointFile=resolve(root,'deploy/test-env/enterprise-oauth-checkpoint.json')
 let checkpoint={schema:'enterprise-oauth-checkpoint.v1',startedAt:new Date().toISOString(),registrySha256:live.sha256,capabilities,results:[],failures:[]}
 if(mode==='--resume-all'){
 if(!existsSync(checkpointFile))throw Error('CHECKPOINT_MISSING')
 checkpoint=JSON.parse(readFileSync(checkpointFile))
 if(checkpoint.schema!=='enterprise-oauth-checkpoint.v1'||checkpoint.registrySha256!==live.sha256||JSON.stringify(checkpoint.capabilities)!==JSON.stringify(capabilities)||Date.now()-Date.parse(checkpoint.startedAt)>600000)throw Error('CHECKPOINT_WINDOW_CHANGED')
 }
 const saveCheckpoint=()=>{if(all)writeFileSync(checkpointFile,JSON.stringify(checkpoint,null,2)+'\n')}
 const scopes=external?['codocs:product-document:read','codocs:project-document:content:read']:all?capabilities:selected.length?selected:['aims:products:view'],results=checkpoint.results
 saveCheckpoint()
 for(const scope of scopes){
 if(results.some(r=>r.scope===scope))continue
 const response=await issue(scope,audience)
 if(!response.ok){checkpoint.failures.push({scope,status:response.status,at:new Date().toISOString()});saveCheckpoint();console.error(JSON.stringify({failedScope:scope,status:response.status,verifiedScopes:results.length}));throw Error(`OAUTH_HTTP_${response.status}`)}
 const payload=await response.json()
 if(payload.token_type!=='Bearer'||payload.scope!==scope||typeof payload.access_token!=='string'||!payload.access_token||payload.access_token.length>32768)throw Error('OAUTH_RESPONSE_INVALID')
 await new Promise((accept,reject)=>{
  const child=spawn('go',['run','./cmd/enterprise-test-credential',...(external?['--verify-codocs-token','--scope',scope]:['--verify-token','--scope',scope])],{cwd:resolve(root,'data-runtime'),stdio:['pipe','pipe','pipe']})
  let result='';child.stdout.on('data',chunk=>{result+=chunk;if(result.length>4096)child.kill()});child.stderr.resume();child.once('error',()=>reject(Error('VERIFIER_START_FAILED')))
  child.once('exit',code=>{if(code!==0)return reject(Error('TOKEN_VERIFICATION_FAILED'));try{const checked=JSON.parse(result);if(!checked.tokenVerified||!checked.stateVerified||checked.scope!==scope||checked.audience!==audience)throw Error();accept()}catch{reject(Error('VERIFIER_RESULT_INVALID'))}})
  child.stdin.on('error',()=>{});child.stdin.end(payload.access_token)
 })
 if(!response.headers.has('cf-ray')||response.headers.get('x-hzy-test-environment')!=='C000001')throw Error('LIVE_GATEWAY_EVIDENCE_MISSING')
 results.push({scope,verifiedAt:new Date().toISOString(),oauthIssued:true,tokenVerified:true,cfRayPresent:true,testGatewayMarker:true});saveCheckpoint()
 if(results.length%8===0)console.log(JSON.stringify({verifiedScopes:results.length,total:scopes.length}))
 }
 const negatives=[]
 for(const [scope,audience]of (external?[['codocs:product-document:read','data-runtime'],['codocs:product-document:create','codocs']]:[['aims:products:view','tenant-runtime'],['aims:unregistered:probe','data-runtime']])){
 const denied=await issue(scope,audience)
 if(![400,403].includes(denied.status))throw Error('NEGATIVE_PROBE_NOT_REJECTED')
 const payload=await denied.json().catch(()=>({}))
 if(payload.access_token)throw Error('NEGATIVE_PROBE_TOKEN_ISSUED')
 negatives.push({scope,audience,rejected:true,status:denied.status})
 }
 const evidence={schema:'enterprise-oauth-live.v1',verifiedAt:new Date().toISOString(),tenant:p.tenantCode,deployment:p.deploymentCode,audience,registrySha256:live.sha256,results,negatives,actualCombinedScopes:[],combinationReason:external?'Product document transport requests one exact Codocs capability':'Foundation callEnterpriseRuntime uses scope: route.capability; no combined-scope calls',configurationMutated:false,localSigning:false,browserAcceptance:false}
 if(external||all||selected.length)writeFileSync(resolve(root,external?'deploy/test-env/enterprise-oauth-codocs-evidence.json':selected.length?`deploy/test-env/enterprise-oauth-selected-${createHash('sha256').update(JSON.stringify([...selected].sort())).digest('hex').slice(0,12)}-evidence.json`:'deploy/test-env/enterprise-oauth-live-evidence.json'),JSON.stringify(evidence,null,2)+'\n')
 console.log(JSON.stringify({oauthIssued:true,tokenVerified:true,verifiedScopeCount:results.length,negativeCount:negatives.length,configurationMutated:false,localSigning:false}))
}
main().catch(error=>{const safe=/^[A-Z_]+(?:_\d+)?$/.test(error?.message)?error.message:'OAUTH_PROBE_FAILED';console.error(safe);process.exitCode=1})
