import {createError,defineEventHandler,readBody} from 'h3'
import {buildOpsAuthorizationSnapshot} from '~~/server/utils/platformOpsRbac'
import {approveDrainActivity} from '~~/server/utils/enterpriseDrainActivityApproval'
export default defineEventHandler(async event=>{
 const actor=String(event.context.platformUid||'')
 if(!actor)throw createError({statusCode:401,message:'Authenticated operator required'})
 if(event.context.platformAccessScope!=='ops'||!(await buildOpsAuthorizationSnapshot(actor)).resources['ops.deployments']?.includes('admin'))throw createError({statusCode:403,message:'Deployment admin permission required'})
 const body=await readBody(event)
 if(!body||Object.keys(body).some(key=>!['mode','snapshot','activityId','requestId','decision'].includes(key))||!['plan','approve'].includes(body.mode||'plan'))throw createError({statusCode:400,message:'Invalid activity review request'})
 try{return await approveDrainActivity(body,actor,body.mode==='approve')}catch(error){const message=error instanceof Error?error.message:'';throw createError({statusCode:message.startsWith('drain_activity_')?409:503,message:message.startsWith('drain_activity_')?message:'Activity review unavailable'})}
})
