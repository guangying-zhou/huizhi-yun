import { createError, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

const numericID=/^[1-9]\d*$/
export async function enterpriseAimsProjectPlan(event:H3Event){
  setHeader(event,'Cache-Control','no-store');const projectId=String(getRouterParam(event,'id')||'').trim();if(!numericID.test(projectId)||!Number.isSafeInteger(Number(projectId)))throw createError({statusCode:400,message:'项目标识无效'})
  const user=await requireEnterpriseUser(event);const authorization=await loadAuthorizationSnapshotFromConsoleRuntime(user.uid,'aims',event)
  for(const resource of ['milestones','work_items'])if(!authorizationResourcesAllow(authorization.resources,resource,'view',authorization.actionPolicies?.[resource]))throw createError({statusCode:403,message:'无项目计划查看权限'})
  const scope=await enterpriseAimsProjectScope(event,user.uid);const input=(query:Record<string,string>)=>({tenant:user.tenant,deployment:user.deployment,projectId,query,authorization:{actorUid:user.uid,tenant:user.tenant,deployment:user.deployment,resource:'project-plan',action:'view',expiresAt:enterpriseRuntimePermitExpiresAt()}})
  await prepareEnterpriseRuntime(event,'aims.project-plan-milestones');await prepareEnterpriseRuntime(event,'aims.project-plan-items')
  async function all(operation:'aims.project-plan-milestones'|'aims.project-plan-items'){const rows:Record<string,unknown>[]=[];for(let page=1;page<=100;page++){const response=await callEnterpriseRuntime(event,operation,input({...scope,page:String(page),pageSize:'100'})) as {data?:Record<string,unknown>[]|{items?:Record<string,unknown>[],total?:number}};const data=response?.data;const batch=Array.isArray(data)?data:(data?.items||[]);rows.push(...batch);if(batch.length<100||rows.length>=Number(!Array.isArray(data)&&data?.total||0))break}return rows}
  const [milestones,items]=await Promise.all([all('aims.project-plan-milestones'),all('aims.project-plan-items')])
  return {code:0,data:{milestones,items}}
}
