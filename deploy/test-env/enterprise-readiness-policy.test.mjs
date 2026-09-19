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
    "'aims.project-list': { path: '/v1/enterprise/aims/projects:list', capability: 'aims:projects:view' },",
    "'assets.product-list': { path: '/v1/enterprise/assets/products:list', capability: 'assets:product:read' }",
    '}'
  ].join('\n'))
  write(root, 'aims/app.manifest.json', JSON.stringify({ appCode: 'aims', resources: [{ code: 'project-documents', actions: ['read', 'download', 'write'] }, { code: 'project-document-sources', actions: ['read'] }, { code: 'project-document-access', actions: ['read', 'manage'] }] }))
  write(root, 'codocs/app.manifest.json', JSON.stringify({ appCode: 'codocs', resources: [{ code: 'product-document', actions: ['read'] }, { code: 'project-document', actions: ['content:read'] }] }))
  write(root, 'console/app.manifest.json', JSON.stringify({ appCode: 'console', resources: [{ code: 'directory-users', actions: ['read'] }] }))
  write(root, 'foundation/server/utils/directoryApi.ts', "const request = { audience: 'console', scope: 'console:directory-users:read' }\n")
  write(root, 'console/server/api/v1/console/service/directory/users/index.get.ts', "requireConsoleServiceActor(event, 'console', 'console:directory-users:read')\n")
  write(root, 'enterprise/server/utils/enterpriseAimsProjectDocuments.ts', "const capability = 'aims:project-documents:read'\n")
  // 预览沿用读取能力，下载是独立的导出性质能力；两条都要进 aims 授权条目
  write(root, 'enterprise/server/utils/enterpriseAimsProjectDocumentFiles.ts', "const capabilities = Object.freeze({ preview: 'aims:project-documents:read', download: 'aims:project-documents:download' })\n")
  // 候选来源只读代理：键是被引号包住的资源名，只有值才是能力
  write(root, 'enterprise/server/utils/enterpriseAimsProjectDocumentSources.ts', "const capabilities = Object.freeze({ 'project-document-sources': 'aims:project-document-sources:read' })\n")
  // 写入能力独立声明：read 不蕴含 write
  write(root, 'enterprise/server/utils/enterpriseAimsProjectDocumentWrites.ts', "const capabilities = Object.freeze({ write: 'aims:project-documents:write' })\n")
  // 访问策略读与改分列：read 不蕴含 manage
  write(root, 'enterprise/server/utils/enterpriseAimsProjectDocumentAccess.ts', "const capabilities = Object.freeze({ read: 'aims:project-document-access:read', manage: 'aims:project-document-access:manage' })\n")
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
      clientCode: 'enterprise.runtime', appCode: 'enterprise', capabilities: ['aims:projects:view', 'assets:product:read'], audiences: ['data-runtime']
    })
    assert.deepEqual(policy.externalServicePolicies, [
      // 同一 audience 下读取与下载两条能力合并，逐条精确
      { audience: 'aims', capabilities: ['aims:project-document-access:manage', 'aims:project-document-access:read', 'aims:project-document-sources:read', 'aims:project-documents:download', 'aims:project-documents:read', 'aims:project-documents:write'] },
        // 同一 audience 下 Assets 与宿主两条能力合并，逐条精确
        { audience: 'codocs', capabilities: ['codocs:product-document:read', 'codocs:project-document:content:read'] },
      { audience: 'console', capabilities: ['console:directory-users:read'] }
    ])
    const rendered = renderReadinessTemplate(template(), root)
    assert.equal(rendered.untouched.deployment, null)
    assert.deepEqual(checkReadinessTemplate(rendered, root).policy, policy)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('fails closed for template drift, wildcard capability and undeclared Aims operation', () => {
  const root = fixture()
  try {
    const rendered = renderReadinessTemplate(template(), root)
    rendered.servicePolicy.capabilities.push('aims:*:*')
    assert.throws(() => checkReadinessTemplate(rendered, root), /READINESS_POLICY_DRIFT/)
    rendered.servicePolicy.capabilities = ['aims:projects:view', 'assets:product:read']
    rendered.externalServicePolicies[0].capabilities = ['aims:project-documents:create']
    assert.throws(() => checkReadinessTemplate(rendered, root), /READINESS_POLICY_DRIFT/)
  } finally { rmSync(root, { recursive: true, force: true }) }
  const incomplete = fixture({ omitAimsCapability: true })
  try {
    assert.throws(() => generateReadinessPolicies(incomplete), /READINESS_POLICY_MANIFEST_CAPABILITY_UNDECLARED/)
  } finally { rmSync(incomplete, { recursive: true, force: true }) }

  // 下载能力必须在 Aims manifest 里显式声明；只在传输层写死不足以成为授权。
  const undeclaredDownload = fixture()
  try {
    writeFileSync(resolve(undeclaredDownload, 'aims/app.manifest.json'), JSON.stringify({ appCode: 'aims', resources: [{ code: 'project-documents', actions: ['read', 'write'] }, { code: 'project-document-sources', actions: ['read'] }, { code: 'project-document-access', actions: ['read', 'manage'] }] }))
    assert.throws(() => generateReadinessPolicies(undeclaredDownload), /READINESS_POLICY_EXTERNAL_INVALID/)
  } finally { rmSync(undeclaredDownload, { recursive: true, force: true }) }

  // 传输层不得凭空扩能力：capabilities 块里出现未声明的动作同样失败关闭。
  const inventedCapability = fixture()
  try {
    writeFileSync(resolve(inventedCapability, 'enterprise/server/utils/enterpriseAimsProjectDocumentFiles.ts'), "const capabilities = Object.freeze({ preview: 'aims:project-documents:read', download: 'aims:project-documents:export' })\n")
    assert.throws(() => generateReadinessPolicies(inventedCapability), /READINESS_POLICY_EXTERNAL_INVALID/)
  } finally { rmSync(inventedCapability, { recursive: true, force: true }) }
  const incompleteAssets = fixture({ omitAssetsCapability: true })
  try {
    assert.throws(() => generateReadinessPolicies(incompleteAssets), /READINESS_POLICY_MANIFEST_CAPABILITY_UNDECLARED/)
  } finally { rmSync(incompleteAssets, { recursive: true, force: true }) }
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
