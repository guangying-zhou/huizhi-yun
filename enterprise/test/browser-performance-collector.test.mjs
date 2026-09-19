import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {collectBrowserPerformance,summarizeBrowserCaptures} from '../scripts/collect-browser-performance.mjs'
const labels={variant:'legacy',scenario:'product-list',cache:'warm',environment:'isolated-fixture',role:'fixture-role',datasetRevision:'fixture-v1',artifact:'fixture-only'}
test('collector strips URLs/query data and retains uncertainty, feeds existing quantiles',()=>{
 const surface={performance:{now:()=>20,getEntriesByType:type=>type==='resource'?[{name:'https://fixture.invalid/aims/api/v1/products/private-code/requests?token=DO_NOT_EXPORT',initiatorType:'fetch',duration:15,transferSize:0,encodedBodySize:0,responseStatus:0}]:[]},frames:[]}
 Object.defineProperty(surface,'document',{get(){throw Error('must not read DOM or cookie')}})
 const capture=collectBrowserPerformance(surface,labels);assert.ok(!JSON.stringify(capture).includes('DO_NOT_EXPORT'));assert.ok(!JSON.stringify(capture).includes('private-code'))
 assert.equal(capture.samples.find(s=>s.metric==='unknown-response-status').value,1)
 assert.equal(summarizeBrowserCaptures([capture]).groups.find(s=>s.metric==='api-requests-status-unknown-duration').p95,null)
 assert.throws(()=>collectBrowserPerformance(surface,{...labels,cookie:'forbidden'}))
})
test('real isolated Chrome resource timing captures successful and failed HTTP, summaries remain insufficient',{skip:process.env.HZY_PERFORMANCE_HEADLESS_TEST!=='1'},async()=>{
 const profile=await mkdtemp(join(tmpdir(),'hzy-perf-browser-'));let chrome
 const script=`Promise.all([fetch('/aims/api/v1/products?private=DO_NOT_EXPORT'),fetch('/api/failure')]).then(()=>setTimeout(()=>{document.getElementById('result').textContent=JSON.stringify((${collectBrowserPerformance.toString()})(globalThis,${JSON.stringify(labels)}))},30))`
 const server=createServer((req,res)=>{
 if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><pre id="result"></pre><script>'+script+'</script>')}
 else{res.writeHead(req.url==='/api/failure'?503:200,{'content-type':'application/json','cache-control':'no-store'});res.end('{"fixture":true}')}
 });await new Promise(done=>server.listen(0,'127.0.0.1',done))
 try{
 const html=await new Promise((accept,reject)=>{chrome=spawn(process.env.HZY_PERFORMANCE_CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--use-mock-keychain','--password-store=basic','--disable-gpu','--disable-sync','--no-default-browser-check','--disable-background-networking','--disable-extensions','--no-first-run','--disable-component-update',`--user-data-dir=${profile}`,'--virtual-time-budget=4000','--dump-dom',`http://127.0.0.1:${server.address().port}/`],{stdio:['ignore','pipe','pipe']});let output='';chrome.stdout.on('data',b=>output+=b);let diagnostic='';chrome.stderr.on('data',b=>{diagnostic=(diagnostic+b).slice(-1000)});const timer=setTimeout(()=>{chrome.kill('SIGKILL');reject(Error('isolated Chrome unavailable; display-linked headless startup timed out'))},30000);chrome.once('error',reject);chrome.once('exit',code=>{clearTimeout(timer);code===0?accept(output):reject(Error('isolated Chrome failed'))})})
 const match=html.match(/<pre id="result">([^<]+)<\/pre>/);assert.ok(match,'browser completed collector')
 const capture=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&gt;','>').replaceAll('&lt;','<'))
 assert.equal(capture.samples.find(s=>s.metric==='browser-fetch-count').value,2)
 assert.equal(capture.samples.find(s=>s.metric==='observed-http-failures').value,1)
 assert.ok(capture.samples.find(s=>s.metric==='resource-encoded-size').value>0)
 assert.ok(!JSON.stringify(capture).includes('DO_NOT_EXPORT'))
 const summary=summarizeBrowserCaptures([capture]);assert.equal(summary.captureCount,1);assert.equal(summary.deploymentReady,false);assert.ok(summary.groups.every(g=>g.p95===null))
 }finally{chrome?.kill();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true})}
})

test('actual local HTTP PerformanceResourceTiming feeds collector and original summarizer',async()=>{
 const server=createServer((req,res)=>{res.writeHead(req.url==='/api/failure'?503:200,{'content-type':'application/json'});res.end('{"isolated":true}')})
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`
 try{
  for(const path of ['/aims/api/v1/products?private=DO_NOT_EXPORT','/api/failure'])await (await fetch(origin+path)).arrayBuffer()
  await new Promise(setImmediate)
  const timing=performance.getEntriesByType('resource').filter(e=>e.name.startsWith(origin+'/'))
  const capture=collectBrowserPerformance({performance:{getEntriesByType:type=>type==='resource'?timing:[],now:()=>performance.now()},frames:[]},labels)
  assert.equal(capture.samples.find(s=>s.metric==='browser-fetch-count').value,2)
  assert.equal(capture.samples.find(s=>s.metric==='observed-http-failures').value,1)
  assert.ok(capture.samples.find(s=>s.metric==='resource-encoded-size').value>0)
  assert.ok(!JSON.stringify(capture).includes('DO_NOT_EXPORT'))
  const summary=summarizeBrowserCaptures([capture]);assert.equal(summary.captureCount,1);assert.equal(summary.groups.find(s=>s.metric==='api-products-http-success-duration').count,1);assert.ok(summary.groups.every(g=>g.p95===null))
 }finally{await new Promise(done=>server.close(done))}
})
