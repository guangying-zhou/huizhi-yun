import { readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const [reportPath,sealPath,reviewPath,outputPath,...flags]=process.argv.slice(2)
if(!reportPath||!sealPath||!reviewPath||!outputPath)throw Error('Usage: review-request.mjs report.json seal.json review.json output.json [--submit-plan|--approve]')
if(flags.some(flag=>!['--submit-plan','--approve'].includes(flag))||flags.length>1)throw Error('Choose one explicit submission mode')
const report=JSON.parse(await readFile(reportPath,'utf8')),seal=JSON.parse(await readFile(sealPath,'utf8')),review=JSON.parse(await readFile(reviewPath,'utf8'))
const digest=value=>createHash('sha256').update(value).digest('hex')
const decisions=[]
for(const entry of report.entries.filter(entry=>entry.classification==='manual-required')) {
  const decision=review.decisions?.find(value=>value.entryId===entry.id)
  if(!decision?.evidencePath)throw Error(`Actual evidence artifact required for ${entry.id}`)
  const evidence=await readFile(decision.evidencePath)
  if(!evidence.length)throw Error('Empty evidence artifact rejected')
  const {evidencePath,...fields}=decision
  decisions.push({...fields,entrySha256:digest(JSON.stringify(entry)),evidenceSha256:digest(evidence)})
}
const input={report,seal,decisions,requestId:review.requestId,approvalReference:review.approvalReference,mode:flags[0]==='--approve'?'approve':'plan'}
if(!flags.length){await writeFile(outputPath,JSON.stringify(input,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({submitted:false,mode:'plan',manualDecisions:decisions.length}));process.exit(0)}
const token=process.env.HZY_PLATFORM_OPS_ACCESS_TOKEN
if(!token)throw Error('Existing operator access token required in process environment')
const response=await fetch('https://hzy.wiztek.cn/api/platform/ops/deployments/external-drain',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)})
if(!response.ok)throw Error(`External evidence review rejected with HTTP ${response.status}`)
await writeFile(outputPath,JSON.stringify(await response.json(),null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({submitted:true,mode:input.mode}))
