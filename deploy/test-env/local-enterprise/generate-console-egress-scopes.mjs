import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const host = join(root, 'enterprise/server')
const registry = join(root, 'foundation/server/utils/enterpriseRuntimeClient.ts')
const output = join(here, 'console-egress-scopes.generated.mjs')

function source(path) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

function walkFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? walkFiles(child) : /\.[cm]?[jt]s$/.test(entry.name) ? [child] : []
  })
}

function operationTable() {
  // Freeze the approved operation surface; parallel uncommitted registry additions
  // must not leak into this deployment allowlist. Regenerate after their commit.
  const file = ts.createSourceFile(registry, execFileSync('git', ['show', 'HEAD:foundation/server/utils/enterpriseRuntimeClient.ts'], { cwd: root, encoding: 'utf8' }), ts.ScriptTarget.Latest, true)
  const declaration = file.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find(item => item.name.getText(file) === 'operations')
  const object = declaration?.initializer
  if (!object || !ts.isAsExpression(object) || !ts.isObjectLiteralExpression(object.expression)) throw Error('Foundation operation table changed shape')
  const table = new Map()
  for (const entry of object.expression.properties) {
    if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.name) || !ts.isObjectLiteralExpression(entry.initializer)) throw Error('Invalid Foundation operation')
    const path = entry.initializer.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(file) === 'path')
    if (!path || !ts.isPropertyAssignment(path) || !ts.isStringLiteral(path.initializer)) throw Error(`Missing path: ${entry.name.text}`)
    const domain = /^\/v1\/enterprise\/(aims|assets|codocs|altoc|console|finance|people)\/[^/?#]+$/.exec(path.initializer.text)?.[1]
    if (!domain) throw Error(`Unsupported Enterprise path: ${entry.name.text}`)
    table.set(entry.name.text, `${domain}:enterprise-host:execute`)
  }
  return table
}

function importedFiles(file, ast) {
  const result = []
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier
    if (!specifier || !ts.isStringLiteral(specifier)) continue
    const name = specifier.text
    let base
    if (name.startsWith('.')) base = resolve(dirname(file), name)
    else if (name.startsWith('~~/server/')) base = join(host, name.slice('~~/server/'.length))
    else continue
    // Owning typed composition is now a transitive part of the Host surface.
    // Follow only these server entry/utility roots, never an independent route tree.
    const owningRoots = ['aims/layer/server', 'aims/server/utils', 'assets/layer/server', 'assets/server/utils'].map(path => join(root, path) + '/')
    if (!base.startsWith(`${host}/`) && !owningRoots.some(prefix => base.startsWith(prefix))) continue
    for (const suffix of ['', '.ts', '.js', '.mjs', '/index.ts']) {
      const path = base + suffix
      try { if (['.ts', '.js', '.mjs'].includes(extname(path)) && readFileSync(path)) { result.push(path); break } } catch {}
    }
  }
  return result
}

export function projectedScopes() {
  const table = operationTable()
  const reached = new Set()
  const operations = new Set()
  const pending = walkFiles(join(host, 'routes'))
  while (pending.length) {
    const path = pending.pop()
    if (reached.has(path)) continue
    reached.add(path)
    const ast = source(path)
    function scan(node) {
      if (ts.isStringLiteral(node) && table.has(node.text)) operations.add(node.text)
      if (ts.isTemplateExpression(node)) {
        const pattern = `^${node.head.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${node.templateSpans.map(span => `[^.]+${span.literal.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('')}$`
        const matching = [...table.keys()].filter(operation => new RegExp(pattern).test(operation))
        // A dynamic operation name must be bounded by the Foundation table.
        if (matching.length) matching.forEach(operation => operations.add(operation))
      }
      ts.forEachChild(node, scan)
    }
    scan(ast)
    pending.push(...importedFiles(path, ast))
  }
  // The collab-documents list is the Host's shared-document center. Only the
  // realtime collaboration session is gated by the disabled Collab profile.
  // The department collaboration operations (session, published head and the
  // v1 -> v2 conversion, plus the read-only version history) sit behind the same disabled profile: hzy0 registers
  // no Runtime route for them, so the egress projection must not list them.
  const excluded = operation => operation === 'codocs.personal-document-collaboration-open'
    || /^codocs\.department-documents-(?:collaboration-open|snapshot-(?:read|prepare|publish)|versions|version-view)$/.test(operation)
  const enabled = [...operations].filter(operation => !excluded(operation)).sort()
  const scopes = [...new Set(enabled.map(operation => table.get(operation)))].sort()
  return { operations: enabled, scopes, reachedFiles: [...reached].map(path => relative(root, path)).sort(), registry: table }
}

// Project closed, typed channel domains and literal capabilities, never app-wide grants.
export function projectedChannels() {
  const ast = source(join(root, 'foundation/server/utils/enterpriseRuntimeChannels.ts'))
  const scheduler = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'callEnterpriseAPFScheduler')
  const type = scheduler?.parameters.find(node => node.name.getText(ast) === 'domain')?.type
  if (!type || !ts.isUnionTypeNode(type) || !type.types.every(node => ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal))) throw Error('APF domain registry changed shape')
  const domains = type.types.map(node => node.literal.text).sort()
  const templates = new Set()
  function channelTemplates(node) {
    if (ts.isTemplateExpression(node)) templates.add(node.getText(ast))
    ts.forEachChild(node, channelTemplates)
  }
  channelTemplates(ast)
  for (const template of ['`${domain}:scheduler:execute`', '`${domain}:notification-detail:authorize`']) {
    if (!templates.has(template)) throw Error(`Channel scope contract changed: ${template}`)
  }
  const runtime = source(join(root, 'foundation/server/utils/tenantRuntimeClient.ts'))
  const audiencePairs = []
  function audiences(node) {
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2 && node.elements.every(item => ts.isStringLiteral(item)) && node.elements.some(item => item.text === 'data-runtime') && node.elements.some(item => item.text === 'tenant-runtime')) audiencePairs.push(node.elements.map(item => item.text))
    ts.forEachChild(node, audiences)
  }
  audiences(runtime)
  if (!audiencePairs.length) throw Error('Runtime audience contract missing')
  const rows = []
  const add = (app, audience, scope, lane, workflowLocal = false) => rows.push({ clientId: `${app}.runtime`, app, audience, scope, lane, workflowLocal })
  for (const domain of domains) {
    if (![...operationTable().values()].includes(`${domain}:enterprise-host:execute`)) throw Error(`Missing Host domain: ${domain}`)
    for (const audience of audiencePairs[0]) {
      add('enterprise', audience, `${domain}:enterprise-host:execute`, 'host')
      add('enterprise', audience, `${domain}:scheduler:execute`, 'scheduler')
      add('enterprise', audience, `${domain}:notification-detail:authorize`, 'notification')
    }
  }
  const directory = source(join(root, 'foundation/server/utils/directoryServiceCommand.ts'))
  const directoryScopes = new Set()
  function literals(node) {
    if (ts.isStringLiteral(node) && /^console:directory-[a-z-]+:(reserve|provision|sync|disable)$/.test(node.text)) directoryScopes.add(node.text)
    ts.forEachChild(node, literals)
  }
  literals(directory)
  if (!directoryScopes.size) throw Error('Directory command registry missing')
  for (const scope of [...directoryScopes].sort()) add('enterprise', 'console', scope, 'directory')
  const proxy = readFileSync(join(host, 'utils/enterpriseWorkflowProxy.ts'), 'utf8')
  const callback = readFileSync(join(root, 'workflow/server/utils/callbackTarget.ts'), 'utf8')
  if (!proxy.includes("scope: 'workflow:proxy'") || !callback.includes("scope: 'enterprise:workflow-callback:execute'")) throw Error('Workflow channel contracts changed shape')
  add('enterprise', 'workflow', 'workflow:proxy', 'approval', true)
  add('workflow', 'enterprise', 'enterprise:workflow-callback:execute', 'callback', true)
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

export function projectedAimsHostChannels() {
  const runtime = source(join(root, 'foundation/server/utils/tenantRuntimeClient.ts'))
  const scopes = new Set()
  function scan(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const fields = Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).filter(p => ts.isStringLiteral(p.initializer)).map(p => [p.name.getText(runtime), p.initializer.text]))
      if (fields.appCode === 'enterprise' && fields.wakePath === '/enterprise/api/internal/aims/drain') scopes.add(fields.scope)
    }
    ts.forEachChild(node, scan)
  }
  scan(runtime)
  const expected = ['aims:integration_operation:execute', 'aims:milestone-rollover:execute', 'aims:notifications-due:execute']
  if (JSON.stringify([...scopes].sort()) !== JSON.stringify(expected.sort())) throw Error('Aims Host scheduler scopes drifted')
  const rows = [...scopes].flatMap(scope => ['data-runtime', 'tenant-runtime'].map(audience => ({ clientId: 'enterprise.runtime', app: 'enterprise', audience, scope })))
  // Only the two registered Aims owning callbacks add this system capability.
  // Fail on registry drift; never infer a wildcard from an app/domain prefix.
  const channels = source(join(root, 'foundation/server/utils/enterpriseRuntimeChannels.ts'))
  const declaration = channels.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find(item => item.name.getText(channels) === 'systemOperations')
  const argument = declaration?.initializer && ts.isCallExpression(declaration.initializer) ? declaration.initializer.arguments[0] : undefined
  if (!argument || !ts.isAsExpression(argument) || !ts.isObjectLiteralExpression(argument.expression)) throw Error('System callback registry changed shape')
  const callbacks = argument.expression.properties.flatMap(entry => {
    if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.name) || !ts.isObjectLiteralExpression(entry.initializer)) throw Error('Invalid system callback entry')
    const fields = Object.fromEntries(entry.initializer.properties.filter(ts.isPropertyAssignment).filter(p => ts.isStringLiteral(p.initializer)).map(p => [p.name.getText(channels), p.initializer.text]))
    return fields.domain === 'aims' ? [[entry.name.text, fields.path]] : []
  }).sort((a, b) => a[0].localeCompare(b[0]))
  const expectedCallbacks = [
    ['aims.completion-callback', '/v1/aims/service/work-item-completion/workflow-callback'],
    ['aims.workflow-callback', '/v1/aims/service/workflow/callback']
  ]
  if (JSON.stringify(callbacks) !== JSON.stringify(expectedCallbacks)) throw Error('Aims owning callback closed set drifted')
  for (const audience of ['data-runtime', 'tenant-runtime']) rows.push({ clientId: 'enterprise.runtime', app: 'enterprise', audience, scope: 'aims:scheduler:execute' })
  for (const [file, audience, capabilities] of [
    ['enterprise/server/utils/enterpriseAimsApprovalActions.ts', 'workflow', ['workflow:action_defs:sync']],
    ['aims/server/utils/workItemCompletionTransport.ts', 'workflow', ['workflow:work-item-complete:create']],
    ['aims/server/utils/codocsOperationTransport.ts', 'codocs', ['codocs:product-document:create', 'codocs:company-weekly-summary:publish']],
    ['foundation/server/utils/notifications.ts', 'notifications', ['notifications:publish']]
  ]) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const scope of capabilities) {
      if (!text.includes(`'${scope}'`)) throw Error(`Aims Host outbound scope missing: ${scope}`)
      rows.push({ clientId: 'enterprise.runtime', app: 'enterprise', audience, scope })
    }
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

export function generatedSource() {
  const { operations, scopes } = projectedScopes()
  return `// GENERATED by generate-console-egress-scopes.mjs from Foundation operations\n// reachable from registered Enterprise Host routes. Do not edit by hand.\nexport const hostRuntimeOperations = ${JSON.stringify(operations, null, 2)}\nexport const hostRuntimeScopes = ${JSON.stringify(scopes, null, 2)}\nexport const apfServiceChannels = ${JSON.stringify(projectedChannels(), null, 2)}\nexport const aimsHostServiceChannels = ${JSON.stringify(projectedAimsHostChannels(), null, 2)}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = generatedSource()
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== expected) throw Error('hzy0 egress scope projection is stale')
  } else writeFileSync(output, expected)
}
