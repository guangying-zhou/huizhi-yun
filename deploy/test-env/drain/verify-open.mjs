import {readFile} from 'node:fs/promises'
import {createHmac,timingSafeEqual} from 'node:crypto'
import {pathToFileURL} from 'node:url'
export function verifyOpenForWrappers(envelope,manifest,token){
 if(!token||envelope?.alg!=='HS256'||typeof envelope.payload!=='string'||!/^[a-f0-9]{64}$/.test(envelope.signature)||!timingSafeEqual(createHmac('sha256',token).update(envelope.payload).digest(),Buffer.from(envelope.signature,'hex')))throw Error('Signed coordinator snapshot required')
 const state=JSON.parse(envelope.payload)
 if(manifest.schemaVersion!=='test-drain-wrappers.v1'||manifest.tenant!=='C000001'||manifest.environment!=='test'||!Array.isArray(manifest.apps)||manifest.apps.length!==2||new Set(manifest.apps.map(value=>value.app)).size!==2)throw Error('Exact wrapper manifest required')
 const actors=manifest.apps.map(value=>value.actor).sort((a,b)=>a.app.localeCompare(b.app))
 if(actors.some(actor=>!['aims','assets'].includes(actor.app)||actor.deployment!==`C000001-test-${actor.app}`||!/^[a-f0-9]{64}$/.test(actor.artifactSha256)))throw Error('Invalid candidate actor')
 if(state.tenant!=='C000001'||state.environment!=='test'||state.mode!=='open'||!Number.isSafeInteger(state.revision)||!state.workerCredentialConfigured||JSON.stringify(state.contract?.actors)!==JSON.stringify(actors))throw Error('Coordinator must be open with the exact candidates and separate worker credential')
 return {verified:true,mode:'open',revision:state.revision,actors,observedAt:new Date().toISOString(),deployed:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const manifest=JSON.parse(await readFile(process.argv[2],'utf8')),token=process.env.HZY_DRAIN_CONTROL_TOKEN
 if(!token)throw Error('Dedicated control token required')
 const response=await fetch('https://hzy-test.huizhi.yun/__test/drain/snapshot',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({tenant:'C000001',environment:'test'})})
 if(!response.ok)throw Error(`Coordinator snapshot HTTP ${response.status}`)
 console.log(JSON.stringify(verifyOpenForWrappers(await response.json(),manifest,token),null,2))
}
