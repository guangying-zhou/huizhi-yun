export function canonicalRegistry(value) {
 if(Array.isArray(value))return '['+value.map(canonicalRegistry).join(',')+']'
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalRegistry(value[k])).join(',')+'}'
 return JSON.stringify(value)
}
export async function registryDigest(registry){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalRegistry(registry)))
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')
}
export async function enterpriseRegistryDigestResponse(request,env){
 if(new URL(request.url).hostname!=='hzy-test.huizhi.yun'||request.method!=='POST'||new URL(request.url).search||!env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN||request.headers.get('authorization')!==`Bearer ${env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN}`)return new Response('Not Found',{status:404})
 try{
 const r=JSON.parse(env.HZY_TENANT_GATEWAY_REGISTRY_JSON),t=r.domains?.['hzy-test.huizhi.yun']
 if(t?.tenantCode!=='C000001'||t.environment!=='test')throw Error()
 return Response.json({schema:'test-registry-digest.v1',sha256:await registryDigest(r),tenant:'C000001',environment:'test',enterpriseDeployment:t.apps?.enterprise?.deploymentCode||null},{headers:{'cache-control':'no-store'}})
 }catch{return new Response('Registry unavailable',{status:503})}
}
