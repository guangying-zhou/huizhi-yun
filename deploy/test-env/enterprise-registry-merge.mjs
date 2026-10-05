/** Prepare only: no Cloudflare write. Remote digest must match local full registry.
 * Cloudflare secret PUT has no atomic CAS: recheck immediately before publishing
 * and verify after; serialize administrative writers outside this tool.
 */
import {readFileSync,statSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {registryDigest} from './enterprise-registry-digest.mjs'
export function mergeEnterpriseSource(registry){
 const next=structuredClone(registry),t=next.domains?.['hzy-test.huizhi.yun']
 if(t?.tenantCode!=='C000001'||t.environment!=='test'||t.apps?.console?.deploymentCode!=='wiztek-test-console'||t.dataRuntime?.endpoint!=='https://hzy-test-runtime.isme.dev')throw Error('REGISTRY_BINDING_MISMATCH')
 const wanted={deploymentCode:'C000001-test-enterprise'}
 if(t.apps.enterprise&&JSON.stringify(t.apps.enterprise)!==JSON.stringify(wanted))throw Error('ENTERPRISE_BINDING_CONFLICT')
 t.apps.enterprise=wanted;return next
}
async function main(){
 const mode=process.argv[2]||'--plan'
 if(!['--plan','--prepare','--recheck-before','--verify-after'].includes(mode)||process.argv.length>3)throw Error('MODE_INVALID')
 if(mode==='--plan'){console.log(JSON.stringify({operation:'merge one enterprise deployment binding only',remoteAuthority:'authenticated canonical registry digest',atomicCAS:false,required:'read immediately before write; verify after; exclusive operator'}));return}
 const dir=resolve(import.meta.dirname,'.cloudflare-workers/gateway'),file=resolve(dir,'secrets.json')
 if(statSync(file).mode&0o077)throw Error('CREDENTIAL_FILE_PERMISSIONS')
 const env=JSON.parse(readFileSync(file)),key=env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
 if(!key)throw Error('GATEWAY_CREDENTIAL_MISSING')
 const r=await fetch('https://hzy-test.huizhi.yun/__test/registry-digest',{method:'POST',redirect:'error',headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)})
 if(!r.ok)throw Error(`REMOTE_DIGEST_HTTP_${r.status}`)
 const state=await r.json();if(state.schema!=='test-registry-digest.v1'||state.tenant!=='C000001'||state.environment!=='test'||!(/^[a-f0-9]{64}$/).test(state.sha256))throw Error('REMOTE_DIGEST_INVALID')
 const receiptFile=resolve(dir,'enterprise-source.receipt.json')
 if(mode!=='--prepare'){
 const receipt=JSON.parse(readFileSync(receiptFile)),expected=mode==='--recheck-before'?receipt.before:receipt.after
 if(state.sha256!==expected)throw Error('REMOTE_REGISTRY_CHANGED')
 console.log(JSON.stringify({verified:true,phase:mode,sha256:state.sha256,atomicCAS:false}));return
 }
 const before=JSON.parse(env.HZY_TENANT_GATEWAY_REGISTRY_JSON),digest=await registryDigest(before)
 if(digest!==state.sha256)throw Error('LOCAL_REGISTRY_STALE')
 const next=mergeEnterpriseSource(before),after=await registryDigest(next)
 // wx prevents silently replacing an earlier reviewed artifact.
 writeFileSync(resolve(dir,'enterprise-source.secret-patch.json'),JSON.stringify({HZY_TENANT_GATEWAY_REGISTRY_JSON:JSON.stringify(next)}),{mode:0o600,flag:'wx'})
 writeFileSync(receiptFile,JSON.stringify({schema:'enterprise-source-merge.v1',before:digest,after,atomicCAS:false,change:"domains.hzy-test.huizhi.yun.apps.enterprise.deploymentCode=C000001-test-enterprise"}),{mode:0o600,flag:'wx'})
 console.log(JSON.stringify({prepared:true,before:digest,after,atomicCAS:false,secretKeysChanged:['HZY_TENANT_GATEWAY_REGISTRY_JSON']}))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{const safe=/^[A-Z_]+(?:_\d+)?$/.test(e?.message)?e.message:'REGISTRY_MERGE_FAILED';console.error(safe);process.exitCode=1})
