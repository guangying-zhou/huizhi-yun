import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

// 取出 getCodocsProjectDocumentContent 的函数体，避免断言命中同文件里
// 其他已经正确分离来源/目标 deployment 的调用（如部门文档搜索）。
function projectDocumentContentCaller() {
  const source = read('server/utils/codocsApi.ts')
  const start = source.indexOf('export async function getCodocsProjectDocumentContent')
  assert.ok(start > 0, 'getCodocsProjectDocumentContent must exist')
  const ends = ['\nexport ', '\ntype ', '\nasync function ', '\nfunction ', '\ninterface ']
    .map(marker => source.indexOf(marker, start + 1))
    .filter(index => index > 0)
  assert.ok(ends.length, 'a following top-level declaration must bound the slice')
  return source.slice(start, Math.min(...ends))
}

test('project document content caller resolves the trusted codocs route and separates source/target deployment', () => {
  const caller = projectDocumentContentCaller()

  // 目标部署来自网关下发的受信服务路由目录，不是来源自身的部署码。
  assert.match(caller, /resolveTrustedServiceAppRoute\(params\.event, 'codocs'\)/)
  assert.match(caller, /targetDeploymentCode = stringValue\(targetRoute\?\.deploymentCode \|\| deploymentCode\)/)
  assert.match(caller, /sourceDeploymentCode: deploymentCode/)
  assert.match(caller, /targetDeploymentCode,/)
  // 旧写法把来源当成目标，经网关到达 Codocs 时签名与跨应用绑定都会失配。
  assert.doesNotMatch(caller, /targetDeploymentCode: deploymentCode/)

  // 出站请求必须声明目标部署，并在有网关上下文时附带受信目标路由头。
  assert.match(caller, /'x-hzy-deployment': targetDeploymentCode/)
  assert.doesNotMatch(caller, /'x-hzy-deployment': deploymentCode/)
  assert.match(caller, /targetRoute \? trustedServiceRequestHeaders\(params\.event, 'codocs'\) : \{\}/)

  // 受信网关上下文存在却解析不出目标路由时必须失败关闭，不得回落到来源部署。
  assert.match(caller, /if \(gateway && !targetRoute\)/)
  assert.match(caller, /statusCode: 503/)
})

test('project document content caller keeps its exact capability, source binding and signed envelope', () => {
  const caller = projectDocumentContentCaller()

  assert.match(caller, /audience: 'codocs'/)
  assert.match(caller, /scope: 'codocs:project-document:content:read'/)
  // 来源 client 由已验签的来源应用派生，enterprise 与 aims 不能交叉组合。
  assert.match(caller, /sourceClientId: `\$\{sourceApp\}\.runtime`/)
  assert.match(caller, /targetApp: 'codocs'/)
  assert.match(caller, /buildServiceCommandRuntimeHeaders/)
})

test('department document caller remains the reference shape for source/target separation', () => {
  const source = read('server/utils/codocsApi.ts')
  // 这条链路本来就正确；保留断言以防两条调用再次分叉。
  assert.match(source, /const targetRoute = resolveTrustedServiceAppRoute\(params\.event, 'codocs'\)/)
  assert.match(source, /throw createError\(\{ statusCode: 503, message: 'Codocs 可信服务路由不可用' \}\)/)
})
