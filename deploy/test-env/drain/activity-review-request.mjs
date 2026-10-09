import { readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const [snapshotPath,reviewPath,outputPath,...flags]=process.argv.slice(2)
if(!snapshotPath||!reviewPath||!outputPath||flags.some(flag=>!['--submit-plan','--approve'].includes(flag))||flags.length>1)throw Error('Usage: activity-review-request.mjs closed-snapshot.json review.json output.json [--submit-plan|--approve]')
const snapshot=JSON.parse(await readFile(snapshotPath,'utf8')),review=JSON.parse(await readFile(reviewPath,'utf8'))
const {evidencePath,executionEndedEvidencePath,...decision}=review.decision||{}
async function digestFile(path){if(!path)throw Error('Actual evidence artifact path required');const value=await readFile(path);if(!value.length)throw Error('Empty evidence rejected');return createHash('sha256').update(value).digest('hex')}
decision.evidenceSha256=await digestFile(evidencePath)
if(executionEndedEvidencePath)decision.executionEndedEvidenceSha256=await digestFile(executionEndedEvidencePath)
const input={snapshot,requestId:review.requestId,activityId:review.activityId,decision,mode:flags[0]==='--approve'?'approve':'plan'}
if(!flags.length){await writeFile(outputPath,JSON.stringify(input,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({submitted:false,mode:'plan'}))}
else{
 const token=process.env.HZY_PLATFORM_OPS_ACCESS_TOKEN;if(!token)throw Error('Existing operator token required in process environment')
 const response=await fetch('https://hzy.wiztek.cn/api/platform/ops/deployments/drain-activity',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)})
 if(!response.ok)throw Error(`Activity review rejected with HTTP ${response.status}`)
 await writeFile(outputPath,JSON.stringify(await response.json(),null,2)+'\n',{mode:0o600});console.log(JSON.stringify({submitted:true,mode:input.mode}))
}
