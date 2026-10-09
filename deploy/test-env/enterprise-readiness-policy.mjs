/**
 * Generates the static, secret-free grant input for Enterprise Runtime.
 * It only reads checked-in manifests, operation declarations and deployment
 * audience configuration; it never
 * loads environment variables, contacts Console/Platform, or applies grants.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { enterprisePilotConfig } from './enterprise-pilot-config.mjs'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const paths = Object.freeze({
  enterpriseManifest: 'enterprise/app.manifest.json',
  foundationOperations: 'foundation/server/utils/enterpriseRuntimeClient.ts',
  codocsManifest: 'codocs/app.manifest.json',
  consoleManifest: 'console/app.manifest.json',
  directoryTransport: 'foundation/server/utils/directoryApi.ts',
  directoryRoute: 'console/server/api/v1/console/service/directory/users/index.get.ts',
  aimsDocumentTransport: 'enterprise/server/utils/enterpriseAimsProjectDocuments.ts',
  // 项目文档的 typed owning 入口；人员 read/export 与 U permit 由业务核心分别校验。
  aimsDocumentFilesTransport: 'enterprise/server/utils/enterpriseAimsProjectDocumentFiles.ts',
  // 项目文档候选来源（部门/项目集 Codocs 文档、仓库 Markdown）的能力事实源。
  aimsDocumentSourcesTransport: 'enterprise/server/utils/enterpriseAimsProjectDocumentSources.ts',
  // 项目文档写入（登记/删除/Markdown 新建）的能力事实源。
  aimsDocumentWritesTransport: 'enterprise/server/utils/enterpriseAimsProjectDocumentWrites.ts',
  // 项目文档访问策略（读取/判定/审计/修改）的能力事实源。
  aimsDocumentAccessTransport: 'enterprise/server/utils/enterpriseAimsProjectDocumentAccess.ts',
  codocsDocumentTransport: 'assets/server/utils/assetProductDocumentTransport.ts',
  // 宿主自己的 codocs 能力事实源。ADR-018 §2 保留 Codocs 独立运行边界，
  // 宿主以 enterprise 身份跨应用调用，能力必须单独声明而不是并进 Assets 那条。
  enterpriseCodocsTransport: 'enterprise/server/utils/enterpriseCodocsProjectDocument.ts'
})
const capabilityPattern = /^[a-z][a-z0-9-]*:[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)*$/
const secretKey = /password|privatekey|secret|accesstoken|credentialvalue/i

function fail(code) { throw new Error(code) }
function read(repoRoot, path) { return readFileSync(resolve(repoRoot, path), 'utf8') }
function json(repoRoot, path) { try { return JSON.parse(read(repoRoot, path)) } catch { fail('READINESS_POLICY_SOURCE_INVALID') } }
function exactCapability(value) {
  if (typeof value !== 'string' || !capabilityPattern.test(value) || value.includes('*')) fail('READINESS_POLICY_CAPABILITY_INVALID')
  return value
}
function noSecrets(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (secretKey.test(key)) fail('READINESS_POLICY_SECRET_FORBIDDEN')
    noSecrets(nested)
  }
}
function appHasCapability(manifest, capability) {
  // 复合动作（codocs:project-document:content:read）在 manifest 里是一个带冒号的
  // action，与 composeManifest 允许的写法一致；按三段硬拆会把这类能力判成未声明。
  const [appCode, resource, ...rest] = capability.split(':')
  const action = rest.join(':')
  return Boolean(action) && manifest?.appCode === appCode
    && Array.isArray(manifest?.resources)
    && manifest.resources.some(item => item?.code === resource && Array.isArray(item.actions) && item.actions.includes(action))
}
function runtimeOperations(source) {
  const entries = [...source.matchAll(/path:\s*'([^']+)'/g)]
  if (!entries.length) fail('READINESS_POLICY_OPERATIONS_MISSING')
  const capabilities = new Set()
  for (const [, path] of entries) {
    const domain = /^\/v1\/enterprise\/(aims|assets|codocs|altoc|console|finance|people)\/[^/?#]+$/.exec(path)?.[1]
    if (!domain) fail('READINESS_POLICY_OPERATION_INVALID')
    capabilities.add(`${domain}:enterprise-host:execute`)
  }
  return [...capabilities].sort()
}
// P1 的项目文档在 owning typed 核心内走固定 U 操作，不再签发 Aims HTTP scope。
const nativeBridges = {
  aimsDocumentTransport: ['readHostProjectDocuments'],
  aimsDocumentFilesTransport: ['readHostProjectDocumentFile'],
  aimsDocumentSourcesTransport: ['readHostProjectDocumentSource'],
  aimsDocumentWritesTransport: ['writeHostProjectDocument'],
  aimsDocumentAccessTransport: ['readProjectDocumentAccessPolicy', 'checkProjectDocumentAccess', 'listProjectDocumentAccessAudit', 'updateProjectDocumentAccessPolicy']
}
function checkNativeBridge(source, expected) {
  const tree = ts.createSourceFile('bridge.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const bindings = new Map()
  const calls = new Set()
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (/aims\/server\/utils\/(serviceIdentity|serviceToken|.*Transport)/i.test(node.moduleSpecifier.text)) fail('READINESS_POLICY_NATIVE_BRIDGE_INVALID')
      if (node.moduleSpecifier.text === '../../../aims/layer/server/index') {
        const named = node.importClause?.namedBindings
        if (named && ts.isNamedImports(named)) for (const item of named.elements) {
          if (!item.isTypeOnly) bindings.set(item.name.text, item.propertyName?.text || item.name.text)
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.add(node.expression.text)
    if (ts.isStringLiteral(node) && /^(aims[.:](read|write)|aims:project-document)/.test(node.text)) fail('READINESS_POLICY_NATIVE_BRIDGE_INVALID')
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (tree.parseDiagnostics.length || expected.some(name => ![...bindings].some(([local, exported]) => exported === name && calls.has(local)))) fail('READINESS_POLICY_NATIVE_BRIDGE_INVALID')
}

function externalPolicy(source, audiencePattern, capabilityPatternSource, manifest) {
  const capability = source.match(capabilityPatternSource)?.[1]
  const audience = audiencePattern ? source.match(audiencePattern)?.[1] : capability?.split(':')[0]
  if (!audience || !capability || audience.includes('*') || !exactCapability(capability) || !appHasCapability(manifest, capability) || capability.split(':')[0] !== audience) fail('READINESS_POLICY_EXTERNAL_INVALID')
  return { audience, capabilities: [capability] }
}

export function generateReadinessPolicies(repoRoot = root) {
  const enterprise = json(repoRoot, paths.enterpriseManifest)
  if (enterprise?.appCode !== 'enterprise' || enterprise?.composition?.permissionCatalogHash == null) fail('READINESS_POLICY_MANIFEST_INVALID')
  const capabilities = runtimeOperations(read(repoRoot, paths.foundationOperations))
  // Host service scopes derive from the fixed operation path domain. Personnel
  // manifest permissions remain separate and do not authorize service tokens.
  for (const [key, expected] of Object.entries(nativeBridges)) checkNativeBridge(read(repoRoot, paths[key]), expected)
  const codocsManifest = json(repoRoot, paths.codocsManifest)
  const codocsAssetsPolicy = externalPolicy(read(repoRoot, paths.codocsDocumentTransport), /audience:\s*'([^']+)'/, /requiredCapability:\s*'([^']+)'/, codocsManifest)
  const codocsProjectPolicy = externalPolicy(read(repoRoot, paths.enterpriseCodocsTransport), /const audience\s*=\s*'([^']+)'/, /const requiredCapability\s*=\s*'([^']+)'/, codocsManifest)
  if (codocsAssetsPolicy.audience !== codocsProjectPolicy.audience) fail('READINESS_POLICY_EXTERNAL_INVALID')
  // 同一 audience 的多条能力合并成一个条目，逐条精确，不引入通配
  const codocsPolicy = {
    audience: codocsAssetsPolicy.audience,
    capabilities: [...new Set([...codocsAssetsPolicy.capabilities, ...codocsProjectPolicy.capabilities])].sort()
  }
  const directorySource = read(repoRoot, paths.directoryTransport)
  const consoleManifest = json(repoRoot, paths.consoleManifest)
  const consoleCapabilities = [...new Set([...directorySource.matchAll(/scope:\s*'(console:[^']+)'/g)].map(match => exactCapability(match[1])))].sort()
  if (!consoleCapabilities.length || consoleCapabilities.some(cap => !appHasCapability(consoleManifest, cap))) fail('READINESS_POLICY_EXTERNAL_INVALID')
  const directoryRoutes = [paths.directoryRoute,
    'console/server/api/v1/console/service/directory/project-access.get.ts',
    'console/server/api/v1/console/service/business-domains.get.ts'].map(path => read(repoRoot, path))
  if (consoleCapabilities.some(cap => !directoryRoutes.some(source => source.includes(`'${cap}'`)))) fail('READINESS_POLICY_DIRECTORY_CONTRACT_MISMATCH')
  const consolePolicy = { audience: 'console', capabilities: consoleCapabilities }
  const externalServicePolicies = [codocsPolicy, consolePolicy].sort((left, right) => left.audience.localeCompare(right.audience))
  const runtimeAudience = enterprisePilotConfig().registryPatch?.apps?.enterprise?.dataRuntime?.audience
  if (!['data-runtime', 'tenant-runtime'].includes(runtimeAudience)) fail('READINESS_POLICY_RUNTIME_AUDIENCE_INVALID')
  const result = {
    servicePolicy: { clientCode: 'enterprise.runtime', appCode: enterprise.appCode, capabilities, audiences: [runtimeAudience] },
    externalServicePolicies
  }
  noSecrets(result)
  return result
}

export function renderReadinessTemplate(template, repoRoot = root) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) fail('READINESS_TEMPLATE_INVALID')
  noSecrets(template)
  const policy = generateReadinessPolicies(repoRoot)
  return { ...template, servicePolicy: policy.servicePolicy, externalServicePolicies: policy.externalServicePolicies }
}

export function checkReadinessTemplate(template, repoRoot = root) {
  const rendered = renderReadinessTemplate(template, repoRoot)
  const valid = JSON.stringify(template.servicePolicy) === JSON.stringify(rendered.servicePolicy)
    && JSON.stringify(template.externalServicePolicies) === JSON.stringify(rendered.externalServicePolicies)
  if (!valid) fail('READINESS_POLICY_DRIFT')
  return { valid: true, policy: { servicePolicy: rendered.servicePolicy, externalServicePolicies: rendered.externalServicePolicies } }
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
function isMain() { return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) }

if (isMain()) {
  try {
    const repoRoot = resolve(argument('--repo') || root)
    const templatePath = argument('--template') || 'deploy/test-env/enterprise-readiness.template.json'
    const template = json(repoRoot, templatePath)
    if (process.argv.includes('--check')) {
      console.log(JSON.stringify(checkReadinessTemplate(template, repoRoot), null, 2))
    } else {
      const rendered = renderReadinessTemplate(template, repoRoot)
      const output = argument('--output')
      if (output) writeFileSync(resolve(output), `${JSON.stringify(rendered, null, 2)}\n`, { mode: 0o600 })
      else console.log(JSON.stringify(rendered, null, 2))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'READINESS_POLICY_FAILED')
    process.exitCode = 1
  }
}
