import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
const helper = new URL('../child-lifecycle.mjs', import.meta.url).href
async function supervisor(source, signal) {
  const code = `import {spawn} from 'node:child_process'; import {superviseChild} from ${JSON.stringify(helper)};
  setInterval(()=>{},1000); const child=spawn(process.execPath,['-e',${JSON.stringify(source)}],{stdio:['ignore','pipe','inherit']});
  superviseChild(child,{app:'fixture'}); child.stdout.on('data',()=>process.stdout.write('ready'));`
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], {stdio:['ignore','pipe','pipe']})
  const timeout=setTimeout(()=>p.kill('SIGKILL'),5000)
  try {
    if(signal){await once(p.stdout,'data');p.kill(signal)}
    return await once(p,'exit')
  } finally {clearTimeout(timeout)}
}
test('supervisor exits with child status despite residual active handles', async()=>{
  assert.deepEqual(await supervisor('process.exit(23)'),[23,null])
  assert.deepEqual(await supervisor('process.exit(0)'),[0,null])
  assert.deepEqual(await supervisor('throw Error("fixture crash")'),[1,null])
})
test('supervisor preserves child signal and forwards SIGTERM/SIGINT',async()=>{
  assert.deepEqual(await supervisor('process.kill(process.pid,"SIGTERM")'),[null,'SIGTERM'])
  for(const signal of ['SIGTERM','SIGINT']) assert.deepEqual(await supervisor('console.log("ready");setInterval(()=>{},1000)',signal),[null,signal])
})
test('spawn failure terminates supervisor',async()=>{
 const p=spawn(process.execPath,['--input-type=module','-e',`import {spawn} from 'node:child_process';import {superviseChild} from ${JSON.stringify(helper)};setInterval(()=>{},1000);superviseChild(spawn('/definitely-not-an-executable'),{app:'fixture'});`]);
 assert.deepEqual(await once(p,'exit'),[1,null])
})

test('run-process installs the terminating supervisor for every selected app',()=>{
 const source=readFileSync(new URL('../run-process.mjs',import.meta.url),'utf8')
 assert.match(source,/superviseChild\(child, \{ app \}\)/)
 assert.doesNotMatch(source,/child\.once\('exit', code => process\.exitCode/)
})
