import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
// All Cloudflare credentials remain in memory. Only whitelisted public config is returned.
export async function observeTestConsumers(runtimeConfig) {
  const result={observedAt:new Date().toISOString(),workers:[],routes:[],runtime:{tenant:runtimeConfig.tenant,deployment:runtimeConfig.deployment,bindings:runtimeConfig.deploymentBindings,appEnabled:Object.fromEntries(Object.entries(runtimeConfig.apps).map(([app,value])=>[app,!!value.enabled]))}}
  for(const app of ['altoc','codocs']) {
    try { const response=await fetch(`https://hzy-test.huizhi.yun/${app}/`,{redirect:'error',signal:AbortSignal.timeout(8000)});const body=await response.text();result.routes.push({app,status:response.status,explicitDisabled:response.status===503&&body==='Application not enabled in test environment'}) } catch {result.routes.push({app,available:false})}
  }
  try {
    const config=await readFile(resolve(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8')
    const token=config.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1]
    if(!token)throw Error('Cloudflare login unavailable')
    async function api(path){const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok||!data.success)throw Error('Read-only API unavailable');return data.result}
    const accounts=await api('/accounts?per_page=50')
    if(!Array.isArray(accounts)||accounts.length!==1)throw Error('Exact account resolution unavailable')
    for(const app of ['aims','assets']) {
      const base=`/accounts/${accounts[0].id}/workers/scripts/hzy-test-${app}`
      const [deploymentResult,schedules]=await Promise.all([api(`${base}/deployments`),api(`${base}/schedules`)])
      const deployments=Array.isArray(deploymentResult)?deploymentResult:deploymentResult.deployments
      const deployment=[...deployments].sort((a,b)=>String(b.created_on).localeCompare(String(a.created_on)))[0]
      if(!deployment||deployment.versions.length!==1||deployment.versions[0].percentage!==100)throw Error('Single active deployment required')
      const version=await api(`${base}/versions/${deployment.versions[0].version_id}`)
      const bindings=version.resources.bindings
      result.workers.push({app,versionId:version.id,deploymentId:deployment.id,handlers:version.resources.script.handlers,schedules,
        services:bindings.filter(value=>value.type==='service').map(value=>({binding:value.name,service:value.service})),
        providerUrls:Object.fromEntries(bindings.filter(value=>value.type==='plain_text'&&/^HZY_(ALTOC|CODOCS)_API_URL$/.test(value.name)).map(value=>[value.name,value.text])),
        drainBoundaryBound:bindings.some(value=>value.type==='service'&&value.name==='HZY_DRAIN_COORDINATOR'&&value.service==='hzy-test-drain-coordinator')})
    }
  } catch {result.cloudflareObservationUnavailable=true}
  return result
}
