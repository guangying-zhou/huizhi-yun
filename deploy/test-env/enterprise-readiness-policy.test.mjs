import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { checkReadinessTemplate, generateReadinessPolicies, renderReadinessTemplate } from './enterprise-readiness-policy.mjs'

function write(root, path, value) {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value)
}

function fixture({ omitAimsCapability = false, omitAssetsCapability = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'enterprise-readiness-policy-'))
  const permissions = ['aims:projects:view', 'aims:project-documents:read']
  if (omitAimsCapability) permissions.shift()
  if (!omitAssetsCapability) permissions.push('assets:product:read')
  write(root, 'enterprise/app.manifest.json', JSON.stringify({ appCode: 'enterprise', composition: { permissionCatalogHash: 'a'.repeat(64), permissionCatalog: { permissionCodes: permissions } } }))
  write(root, 'foundation/server/utils/enterpriseRuntimeClient.ts', [
    "const operations = {",
    "'aims.project-list': { path: '/v1/enterprise/aims/projects:list' },",
    "'assets.product-list': { path: '/v1/enterprise/assets/products:list' }",
    '}'
  ].join('\n'))
  write(root, 'aims/app.manifest.json', JSON.stringify({ appCode: 'aims', resources: [{ code: 'project-documents', actions: ['read', 'download', 'write'] }, { code: 'project-document-sources', actions: ['read'] }, { code: 'project-document-access', actions: ['read', 'manage'] }] }))
  write(root, 'codocs/app.manifest.json', JSON.stringify({ appCode: 'codocs', resources: [{ code: 'product-document', actions: ['read'] }, { code: 'project-document', actions: ['content:read'] }] }))
  write(root, 'console/app.manifest.json', JSON.stringify({ appCode: 'console', resources: [{ code: 'directory-users', actions: ['read'] }, { code: 'directory-project-access', actions: ['read'] }, { code: 'business-domain', actions: ['view'] }] }))
  write(root, 'foundation/server/utils/directoryApi.ts', "const requests = [{ audience: 'console', scope: 'console:directory-users:read' }, { audience: 'console', scope: 'console:directory-project-access:read' }, { audience: 'console', scope: 'console:business-domain:view' }]\n")
  write(root, 'console/server/api/v1/console/service/directory/project-access.get.ts', "requireConsoleServiceActor(event, 'console', 'console:directory-project-access:read')\n")
  write(root, 'console/server/api/v1/console/service/business-domains.get.ts', "requireConsoleServiceActor(event, 'console', 'console:business-domain:view')\n")
  write(root, 'console/server/api/v1/console/service/directory/users/index.get.ts', "requireConsoleServiceActor(event, 'console', 'console:directory-users:read')\n")
  const bridges = {
    enterpriseAimsProjectDocuments: ['readHostProjectDocuments'],
    enterpriseAimsProjectDocumentFiles: ['readHostProjectDocumentFile'],
    enterpriseAimsProjectDocumentSources: ['readHostProjectDocumentSource'],
    enterpriseAimsProjectDocumentWrites: ['writeHostProjectDocument'],
    enterpriseAimsProjectDocumentAccess: ['readProjectDocumentAccessPolicy', 'checkProjectDocumentAccess', 'listProjectDocumentAccessAudit', 'updateProjectDocumentAccessPolicy']
  }
  for (const [file, names] of Object.entries(bridges)) write(root, `enterprise/server/utils/${file}.ts`,
    `import { ${names.join(', ')} } from '../../../aims/layer/server/index'\n${names.map(name => `${name}()`).join('\n')}`)
  write(root, 'assets/server/utils/assetProductDocumentTransport.ts', "const request = { audience: 'codocs', requiredCapability: 'codocs:product-document:read' }\n")
  // 宿主自己的 codocs 能力事实源：同一 audience 下与 Assets 那条合并
  write(root, 'enterprise/server/utils/enterpriseCodocsProjectDocument.ts', "const requiredCapability = 'codocs:project-document:content:read'\nconst audience = 'codocs'\n")
  return root
}

const template = () => ({ schemaVersion: 'enterprise-test-preflight.v1', environment: 'test', untouched: { deployment: null } })

test('derives exact Runtime and independent external policies from checked-in contracts', () => {
  const root = fixture()
  try {
    const policy = generateReadinessPolicies(root)
    assert.deepEqual(policy.servicePolicy, {
      clientCode: 'enterprise.runtime', appCode: 'enterprise', capabilities: ['aims:enterprise-host:execute', 'assets:enterprise-host:execute'], audiences: ['data-runtime']
    })
    assert.deepEqual(policy.externalServicePolicies, [
        // 同一 audience 下 Assets 与宿主两条能力合并，逐条精确
        { audience: 'codocs', capabilities: ['codocs:product-document:read', 'codocs:project-document:content:read'] },
      { audience: 'console', capabilities: ['console:business-domain:view', 'console:directory-project-access:read', 'console:directory-users:read'] }
    ])
    const rendered = renderReadinessTemplate(template(), root)
    assert.equal(rendered.untouched.deployment, null)
    assert.deepEqual(checkReadinessTemplate(rendered, root).policy, policy)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('fails closed for template drift, wildcard capability and invalid native Aims bridge', () => {
  const root = fixture()
  try {
    const rendered = renderReadinessTemplate(template(), root)
    rendered.servicePolicy.capabilities.push('aims:*:*')
    assert.throws(() => checkReadinessTemplate(rendered, root), /READINESS_POLICY_DRIFT/)
    rendered.servicePolicy.capabilities = ['aims:enterprise-host:execute', 'assets:enterprise-host:execute']
    rendered.externalServicePolicies[0].capabilities = ['aims:project-documents:create']
    assert.throws(() => checkReadinessTemplate(rendered, root), /READINESS_POLICY_DRIFT/)
  } finally { rmSync(root, { recursive: true, force: true }) }

  for (const source of [
    "import { readHostProjectDocumentFile } from '../../../aims/server/utils/legacy'\nreadHostProjectDocumentFile()",
    "import { readHostProjectDocumentFile } from '../../../aims/layer/server/index'",
    "import { readHostProjectDocumentFile } from '../../../aims/layer/server/index'\nreadHostProjectDocumentFile(); const scope = 'aims.read'"
  ]) {
    const invalid = fixture()
    try {
      write(invalid, 'enterprise/server/utils/enterpriseAimsProjectDocumentFiles.ts', source)
      assert.throws(() => generateReadinessPolicies(invalid), /READINESS_POLICY_NATIVE_BRIDGE_INVALID/)
    } finally { rmSync(invalid, { recursive: true, force: true }) }
  }
  const aliased = fixture()
  try {
    write(aliased, 'enterprise/server/utils/enterpriseAimsProjectDocumentFiles.ts', "import { readHostProjectDocumentFile as readFile } from '../../../aims/layer/server/index'\nreadFile()")
    assert.doesNotThrow(() => generateReadinessPolicies(aliased))
  } finally { rmSync(aliased, { recursive: true, force: true }) }
})

test('refuses secret-bearing templates and does not read process environment', () => {
  const root = fixture()
  try {
    const unsafe = template()
    unsafe.password = 'not-output'
    assert.throws(() => renderReadinessTemplate(unsafe, root), /READINESS_POLICY_SECRET_FORBIDDEN/)
    assert.doesNotMatch(readFileSync(new URL('./enterprise-readiness-policy.mjs', import.meta.url), 'utf8'), /process\.env/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('refuses an undeclared or mismatched Console directory service capability', () => {
  const root = fixture()
  try {
    write(root, 'console/server/api/v1/console/service/directory/users/index.get.ts', "requireConsoleServiceActor(event, 'console', 'console:other:read')")
    assert.throws(() => generateReadinessPolicies(root), /READINESS_POLICY_DIRECTORY_CONTRACT_MISMATCH/)
    write(root, 'console/server/api/v1/console/service/directory/users/index.get.ts', "requireConsoleServiceActor(event, 'console', 'console:directory-users:read')")
    write(root, 'console/app.manifest.json', JSON.stringify({ appCode: 'console', resources: [] }))
    assert.throws(() => generateReadinessPolicies(root), /READINESS_POLICY_EXTERNAL_INVALID/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// 固定 U 操作来自 Foundation 登记；退役服务资源不再借人员 manifest 证明。
test('IP asset link-product fixed U operation is registered and composed into readiness', () => {
  const operationsSource = readFileSync(new URL('../../foundation/server/utils/enterpriseRuntimeClient.ts', import.meta.url), 'utf8')
  assert.match(operationsSource, /'assets\.ip-assets-link-product':\s*\{\s*path: '\/v1\/enterprise\/assets\/ip-assets:link-product'/)
  const policy = generateReadinessPolicies()
  assert.ok(policy.servicePolicy.capabilities.includes('assets:enterprise-host:execute'))
  const root = fixture()
  try {
    const operations = resolve(root, 'foundation/server/utils/enterpriseRuntimeClient.ts')
    writeFileSync(operations, readFileSync(operations, 'utf8') + "\nconst link = { path: '/v1/enterprise/unknown/ip-assets:link-product' }\n")
    assert.throws(() => generateReadinessPolicies(root), /READINESS_POLICY_OPERATION_INVALID/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
