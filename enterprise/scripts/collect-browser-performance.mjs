import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {summarizePerformance} from './summarize-performance.mjs'

// Self-contained so its source can run in the current browser context. Read-only:
// no fetch, storage, cookies, headers, DOM text, URL export, or server instrumentation.
export function collectBrowserPerformance(surface,labels){
 const keys=['variant','scenario','cache','environment','role','datasetRevision','artifact']
 if(!labels||Object.keys(labels).some(k=>!keys.includes(k))||keys.some(k=>typeof labels[k]!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(labels[k]))||!['legacy','enterprise'].includes(labels.variant)||!['cold','warm'].includes(labels.cache))throw Error('PERFORMANCE_LABELS_INVALID')
 const samples=[],frames=[];let unreadable=0
 const add=(metric,unit,value)=>{if(Number.isFinite(value)&&value>=0)samples.push({...labels,metric,unit,value})}
 const classify=name=>{
 let path;try{path=new URL(name).pathname}catch{return 'other'}
 if(/\/api\/.*auth\/me$/.test(path))return 'auth-me'
 if(/permissions$/.test(path))return 'permissions'
 if(/\/products\/[^/]+\/requests$/.test(path))return 'requests'
 if(/\/products$/.test(path))return 'products'
 if(/\/versions(?:\/[^/]+)?$/.test(path))return 'versions'
 if(/\/components$/.test(path))return 'components'
 if(/\/asset-categories$/.test(path))return 'categories'
 return 'other'
 }
 let resources=0,fetches=0,transfer=0,encoded=0,decoded=0,failures=0,unknownStatus=0,incompleteSizes=0,possiblyTruncated=0
 const visit=(win,depth)=>{
 if(depth>4){unreadable++;return}
 try{
 const perf=win.performance,entries=perf.getEntriesByType('resource'),nav=perf.getEntriesByType('navigation')[0]
 const prefix=depth===0?'root':'child'
 if(nav&&nav.duration>0)add(prefix+'-navigation','ms',nav.duration)
 if(entries.length>=Number(perf.resourceTimingBufferSize||250))possiblyTruncated++
 for(const entry of entries){
 resources++;transfer+=Number(entry.transferSize)||0;encoded+=Number(entry.encodedBodySize)||0;decoded+=Number(entry.decodedBodySize)||0
 if(!entry.transferSize&&!entry.encodedBodySize)incompleteSizes++
 if(Number(entry.responseStatus)>=400)failures++
 else if(!Number(entry.responseStatus))unknownStatus++
 if(['fetch','xmlhttprequest'].includes(entry.initiatorType)){fetches++;add('api-'+classify(entry.name)+'-'+(Number(entry.responseStatus)>=400?'http-error':Number(entry.responseStatus)>=200?'http-success':'status-unknown')+'-duration','ms',entry.duration)}
 }
 frames.push({depth,resourceCount:entries.length,navigationObserved:Boolean(nav),timeSinceNavigationMs:perf.now()})
 for(let i=0;i<win.frames.length;i++)visit(win.frames[i],depth+1)
 }catch{unreadable++}
 }
 visit(surface,0)
 for(const [metric,unit,value]of [['browser-resource-count','count',resources],['browser-fetch-count','count',fetches],['resource-transfer-size','bytes',transfer],['resource-encoded-size','bytes',encoded],['resource-decoded-size','bytes',decoded],['observed-http-failures','count',failures],['unknown-response-status','count',unknownStatus],['unavailable-or-zero-body-size','count',incompleteSizes],['unreadable-frame-count','count',unreadable],['possibly-truncated-frame-count','count',possiblyTruncated]])add(metric,unit,value)
 return {schemaVersion:'enterprise-browser-performance.v1',labels,samples,frames,coverage:{requestCountMeaning:'resource timing entries; includes cache, excludes invisible server-side calls and main navigation',responseBytesMeaning:'browser timing byte fields; zero may be cache or unavailable, not proof of zero payload',cacheClassification:'operator supplied; collector does not clear caches or prove cold start',window:'since current document navigation; call once after fixed UI-ready criterion',sqlMetrics:null,workerMetrics:null,failedNavigationMetrics:null},deploymentReady:false}
}
export function summarizeBrowserCaptures(captures){
 if(!Array.isArray(captures)||!captures.length||captures.some(c=>c?.schemaVersion!=='enterprise-browser-performance.v1'||!Array.isArray(c.samples)))throw Error('PERFORMANCE_CAPTURE_INVALID')
 return {...summarizePerformance(captures.flatMap(c=>c.samples)),captureCount:captures.length,sqlMetrics:null,workerMetrics:null}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
 if(process.argv[2]==='--browser-script'&&process.argv.length===4){const labels=JSON.parse(process.argv[3]);collectBrowserPerformance({performance:{getEntriesByType:()=>[],now:()=>0},frames:[]},labels);console.log(`(${collectBrowserPerformance.toString()})(globalThis,${JSON.stringify(labels)})`)}
 else if(process.argv.length===3)console.log(JSON.stringify(summarizeBrowserCaptures(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2))
 else throw Error('ARGUMENTS_INVALID')
 }catch{console.error('PERFORMANCE_INPUT_INVALID');process.exitCode=1}
}
