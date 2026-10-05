import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const modules = ['aims', 'assets', 'codocs', 'altoc', 'console', 'workflow', 'platform', 'people', 'finance']
const resources = Object.fromEntries(modules.map(module => [
  module,
  new Set(JSON.parse(readFileSync(resolve(root, module, 'app.manifest.json'), 'utf8')).resources.map(item => item.code))
]))

// Argument positions refer only to personnel authorization. Runtime permit
// `resource:` labels are transport contracts and intentionally absent here.
// The unqualified hasPermission name is scanned only in People server code;
// elsewhere it may describe unrelated predicates rather than personnel RBAC.
const personnelHelpers = new Map([
  ['authorizationResourcesAllow', { index: 1 }],
  ['checkPermission', { index: 1 }],
  ['requirePermission', { index: 1 }],
  ['hasPermissionInSnapshot', { index: 1 }],
  ['evaluateFlatSnapshotPermission', { index: 1, property: 'resourceCode' }],
  ['evaluateFoundationScopedAuthorization', { index: 0, property: 'required.resourceCode' }],
  ['evaluateFoundationProductAuthorization', { index: 0, property: 'required.resourceCode' }],
  ['checkProductPermission', { index: 2 }],
  ['requireProductPermission', { index: 2 }],
  ['assertPeoplePermission', { index: 1 }],
  ['hasPermission', { index: 1 }],
  ['checkAimsScopedPermission', { index: 1, property: 'resourceCode' }],
  ['loadProjectCommandAuthorization', { index: 2, property: 'resource' }],
  ['loadPolicyScopedAuthorization', { index: 3, property: 'resourceCode' }],
  ['loadScopedAuthorizationFromConsoleRuntime', { index: 3, property: 'resourceCode' }],
  ['loadSubjectScopedAuthorizationByService', { index: 0, property: 'resourceCode' }],
  ['loadFinanceScopedGrants', { index: 2 }],
  ['assetsObjectAccessFromScopedAuthorization', { index: 1 }],
  ['resolveAltocDataAccessQueryFromScopedGrants', { index: 0, property: 'resource' }]
])

// Reviewed variable/forwarded personnel-resource checks. A new site needs a
// human trace back to a manifest literal before this inventory is updated.
const forwardedResourceAllowlist = [
  'aims/server/api/v1/authorization/instance-conflict-explain.post.ts:27:9 requirePermission',
  'aims/server/utils/aimsScopedAuthorization.ts:93:24 loadScopedAuthorizationFromConsoleRuntime',
  'aims/server/utils/checkPermission.ts:110:25 checkPermission',
  'aims/server/utils/checkPermission.ts:85:12 authorizationResourcesAllow',
  'aims/server/utils/productAuthorization.ts:33:31 loadScopedAuthorizationFromConsoleRuntime',
  'aims/server/utils/productAuthorization.ts:36:20 evaluateFoundationProductAuthorization',
  'aims/server/utils/productAuthorization.ts:41:24 checkProductPermission',
  'aims/server/utils/productFeedbackAuthorization.ts:12:31 loadSubjectScopedAuthorizationByService',
  'aims/server/utils/productFeedbackAuthorization.ts:18:20 evaluateFoundationProductAuthorization',
  'altoc/server/api/v1/authorization/instance-conflict-explain.post.ts:33:9 requirePermission',
  'altoc/server/api/v1/documents/external-view.get.ts:121:9 requirePermission',
  'altoc/server/api/v1/documents/index.post.ts:111:9 requirePermission',
  'altoc/server/api/v1/documents/preview.get.ts:124:9 requirePermission',
  'altoc/server/middleware/altoc-permission.ts:29:9 requirePermission',
  'altoc/server/utils/altocScopedAuthorization.ts:106:12 resolveAltocDataAccessQueryFromScopedGrants',
  'altoc/server/utils/altocScopedAuthorization.ts:115:24 loadScopedAuthorizationFromConsoleRuntime',
  'altoc/server/utils/altocScopedAuthorization.ts:124:17 resolveAltocDataAccessQueryFromScopedGrants',
  'altoc/server/utils/checkPermission.ts:131:25 checkPermission',
  'assets/server/api/v1/authorization/instance-conflict-explain.post.ts:17:9 requirePermission',
  'assets/server/middleware/assets-permission.ts:20:9 requirePermission',
  'assets/server/utils/assetsScopedAuthorization.ts:43:24 loadScopedAuthorizationFromConsoleRuntime',
  'assets/server/utils/checkPermission.ts:37:12 authorizationResourcesAllow',
  'assets/server/utils/checkPermission.ts:63:25 checkPermission',
  'assets/server/utils/productAdoptionAuthorization.ts:9:28 loadSubjectScopedAuthorizationByService',
  'codocs/server/utils/checkPermission.ts:34:10 authorizationResourcesAllow',
  'codocs/server/utils/checkPermission.ts:56:25 checkPermission',
  'codocs/server/utils/publishedAssetShortLinks.ts:16:9 requirePermission',
  'console/server/api/auth/scoped-authorization.post.ts:31:79 loadPolicyScopedAuthorization',
  'console/server/api/v1/console/user/scoped-authorization.post.ts:54:28 loadPolicyScopedAuthorization',
  'console/server/middleware/page-access.ts:61:8 hasPermissionInSnapshot',
  'console/server/utils/checkPermission.ts:58:12 hasPermissionInSnapshot',
  'console/server/utils/checkPermission.ts:99:25 checkPermission',
  'console/server/utils/policyAuthorization.ts:570:12 evaluateFlatSnapshotPermission',
  'console/server/utils/policyScopedAuthorization.ts:100:7 evaluateFoundationScopedAuthorization',
  'console/server/utils/subjectEligibility.ts:48:28 evaluateFlatSnapshotPermission',
  'console/server/utils/subjectScopedAuthorization.ts:49:30 loadPolicyScopedAuthorization',
  'enterprise/server/routes/aims/api/v1/products/[productCode]/adoption.get.ts:34:28 loadScopedAuthorizationFromConsoleRuntime',
  'enterprise/server/routes/assets/api/v1/write-access.get.ts:12:30 loadScopedAuthorizationFromConsoleRuntime',
  'enterprise/server/routes/enterprise/api/navigation.get.ts:45:9 authorizationResourcesAllow',
  'enterprise/server/utils/enterpriseAimsProjectPlan.ts:15:59 authorizationResourcesAllow',
  'enterprise/server/utils/enterpriseAimsTimeEntryReviews.ts:28:10 evaluateFoundationScopedAuthorization',
  'enterprise/server/utils/enterpriseAimsTimesheet.ts:115:40 authorizationResourcesAllow',
  'enterprise/server/utils/enterpriseAimsWorkItemWorkspace.ts:109:8 authorizationResourcesAllow',
  'enterprise/server/utils/enterpriseAimsWorkItemWorkspace.ts:116:18 loadProjectCommandAuthorization',
  'enterprise/server/utils/enterpriseAimsWorkItemWrite.ts:31:13 loadProjectCommandAuthorization',
  'enterprise/server/utils/enterpriseAimsWorkItemWrite.ts:33:30 loadScopedAuthorizationFromConsoleRuntime',
  'enterprise/server/utils/enterpriseAltocReads.ts:77:10 authorizationResourcesAllow',
  'enterprise/server/utils/enterpriseAltocReads.ts:78:26 loadScopedAuthorizationFromConsoleRuntime',
  'enterprise/server/utils/enterpriseAltocReads.ts:82:20 evaluateFoundationScopedAuthorization',
  'enterprise/server/utils/enterpriseAltocReads.ts:97:22 resolveAltocDataAccessQueryFromScopedGrants',
  'enterprise/server/utils/enterpriseAssetsLinks.ts:18:28 loadScopedAuthorizationFromConsoleRuntime',
  'enterprise/server/utils/enterpriseAssetsProducts.ts:46:27 loadScopedAuthorizationFromConsoleRuntime',
  'enterprise/server/utils/enterpriseIPAssetsLinkProduct.ts:20:28 loadScopedAuthorizationFromConsoleRuntime',
  'enterprise/server/utils/enterpriseProductHandoffCandidates.ts:24:12 checkAimsScopedPermission',
  'enterprise/server/utils/enterpriseProductReadGate.ts:11:8 authorizationResourcesAllow',
  'finance/server/middleware/finance-permission.ts:23:9 requirePermission',
  'finance/server/utils/checkPermission.ts:116:25 checkPermission',
  'finance/server/utils/checkPermission.ts:90:10 authorizationResourcesAllow',
  'finance/server/utils/financeScopedAuthorization.ts:141:24 loadScopedAuthorizationFromConsoleRuntime',
  'finance/server/utils/financeScopedAuthorization.ts:178:26 loadFinanceScopedGrants',
  'foundation/server/utils/applicationAuthorization.ts:794:20 evaluateFoundationScopedAuthorization',
  'foundation/server/utils/instanceConflictExplanation.ts:207:20 evaluateFoundationScopedAuthorization',
  'foundation/server/utils/projectCommandAuthorization.ts:13:24 loadScopedAuthorizationFromConsoleRuntime',
  'foundation/server/utils/projectCommandAuthorization.ts:16:19 evaluateFoundationScopedAuthorization',
  'foundation/server/utils/projectScopeAuthorization.ts:44:47 evaluateFoundationScopedAuthorization',
  'foundation/server/utils/projectScopeAuthorization.ts:88:15 evaluateFoundationScopedAuthorization',
  'foundation/server/utils/scopeEvaluator.ts:266:10 evaluateFoundationScopedAuthorization',
  'foundation/server/utils/scopeEvaluator.ts:279:47 evaluateFoundationScopedAuthorization',
  'foundation/server/utils/scopeEvaluator.ts:304:11 evaluateFoundationProductAuthorization',
  'people/server/api/admin/directory-sync/import.post.ts:140:10 authorizationResourcesAllow',
  'people/server/middleware/tenant-runtime.ts:509:26 assertPeoplePermission',
  'people/server/utils/peoplePermissions.ts:18:10 authorizationResourcesAllow',
  'people/server/utils/peoplePermissions.ts:31:55 hasPermission',
  'people/server/utils/peopleScopedAuthorization.ts:163:24 loadScopedAuthorizationFromConsoleRuntime',
  'workflow/server/middleware/data-runtime.ts:58:13 requirePermission',
  'workflow/server/utils/checkPermission.ts:30:12 authorizationResourcesAllow',
  'workflow/server/utils/checkPermission.ts:58:25 checkPermission'
]

function moduleFor(file, call, source) {
  const owner = file.split('/')[0]
  const helperName = call.expression.getText(source).split('.').at(-1)
  if (helperName === 'loadPolicyScopedAuthorization' && ts.isStringLiteral(call.arguments[1])) return call.arguments[1].text
  if (owner !== 'enterprise' && owner !== 'foundation') return owner
  if (owner === 'foundation') return 'aims' // current Foundation project authorization adapters
  const name = file.toLowerCase()
  if (name.includes('contractactivation')) {
    const app = call.arguments[2]
    return app && ts.isStringLiteral(app) ? app.text : 'altoc'
  }
  if (name.includes('codocs')) return 'codocs'
  if (name.includes('workflow')) return 'workflow'
  if (name.includes('altoc')) return 'altoc'
  if (name.includes('assets') || name.includes('ipassets') || name.includes('digitalassets')) return 'assets'
  if (name.includes('console') || name.includes('directory')) return 'console'
  const scopedApp = call.expression.getText(source).endsWith('loadScopedAuthorizationFromConsoleRuntime')
    ? call.arguments[2]
    : null
  if (scopedApp && ts.isStringLiteral(scopedApp)) return scopedApp.text
  return 'aims'
}

function resourceExpressions(node, property, declarations, seen = new Set()) {
  if (!node) return []
  if (!property) return [node]
  const [head, ...rest] = property.split('.')
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const declaration = declarations.get(node.text)
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return resourceExpressions(declaration.initializer, property, declarations, new Set([...seen, node.text]))
    }
  }
  if (!ts.isObjectLiteralExpression(node)) return []
  return node.properties
    .flatMap((item) => {
      if (ts.isPropertyAssignment(item) && item.name.getText() === head) {
        return rest.length ? resourceExpressions(item.initializer, rest.join('.'), declarations, seen) : [item.initializer]
      }
      if (ts.isShorthandPropertyAssignment(item) && item.name.text === head) {
        return rest.length ? resourceExpressions(item.name, rest.join('.'), declarations, seen) : [item.name]
      }
      return []
    })
}

function literals(node, declarations, seen = new Set()) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return literals(node.expression, declarations, seen)
  }
  if (ts.isConditionalExpression(node)) {
    return [...literals(node.whenTrue, declarations, seen), ...literals(node.whenFalse, declarations, seen)]
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(item => literals(item, declarations, seen))
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const declaration = declarations.get(node.text)
    if (!declaration) return []
    const next = new Set([...seen, node.text])
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) return literals(declaration.initializer, declarations, next)
    if (ts.isVariableDeclaration(declaration) && ts.isForOfStatement(declaration.parent?.parent)) {
      return literals(declaration.parent.parent.expression, declarations, next)
    }
    const type = declaration.type
    if (type && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return [type.literal.text]
    if (type && ts.isUnionTypeNode(type)) {
      return type.types.flatMap(item => ts.isLiteralTypeNode(item) && ts.isStringLiteral(item.literal) ? [item.literal.text] : [])
    }
  }
  return []
}

function inspect(file, code) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
  const declarations = new Map()
  const findings = []
  const visits = []
  const forwarded = []
  function collect(node) {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node)
    ts.forEachChild(node, collect)
  }
  collect(source)
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source).split('.').at(-1)
      const helper = personnelHelpers.get(name)
      if (helper && (name !== 'hasPermission' || file.startsWith('people/'))
        // Platform checkPermission(tenant, uid, app, resource, action) has a
        // different signature; index 1 is a UID, not a resource.
        && !(name === 'checkPermission' && file.startsWith('platform/'))) {
        const owner = moduleFor(file, node, source)
        const position = source.getLineAndCharacterOfPosition(node.getStart(source))
        const line = position.line + 1
        visits.push({ file, line, helper: name, owner })
        const expressions = resourceExpressions(node.arguments[helper.index], helper.property, declarations)
        // Keep the forwarding inventory separate from the literal/manifest
        // check. A variable may resolve today but can change its origin later.
        let variableResource = expressions.length === 0
        for (const expression of expressions) {
          if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
            variableResource = true
          }
          for (const resource of literals(expression, declarations)) {
            if (!resources[owner]?.has(resource)) findings.push(`${file}:${line} ${name} requires ${owner}:${resource}, absent from manifest`)
          }
        }
        if (variableResource) forwarded.push(`${file}:${line}:${position.character + 1} ${name}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { findings, visits, forwarded }
}

test('server personnel permission resource literals belong to their module manifest', () => {
  const files = execFileSync('rg', [
    '--files', 'enterprise/server', 'foundation/server', ...modules.map(module => `${module}/server`), '-g', '*.ts'
  ], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  const results = files.map(file => inspect(file, readFileSync(resolve(root, file), 'utf8')))
  const visits = results.flatMap(result => result.visits)
  assert.ok(visits.length > 500, 'personnel helper inventory unexpectedly shrank')
  assert.deepEqual(results.flatMap(result => result.findings), [])
  assert.deepEqual(results.flatMap(result => result.forwarded).sort(), forwardedResourceAllowlist)
})

test('guard rejects orphan personnel literals and ignores service permit labels', () => {
  const code = `
    authorizationResourcesAllow(snapshot.resources, 'removed-resource', 'view')
    loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', { resourceCode: 'orphan', action: 'view' })
    const required = { resourceCode: 'orphan-via-local', action: 'view' }
    loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', required)
    for (const resource of ['projects', 'orphan-via-loop']) checkPermission(event, resource, 'view')
    loadProjectCommandAuthorization(event, user, { resource: 'orphan-command', action: 'edit' })
    evaluateFoundationScopedAuthorization({ required: { appCode: 'aims', resourceCode: 'orphan-evaluation', action: 'view' } })
    loadPolicyScopedAuthorization(uid, 'aims', event, { resourceCode: 'orphan-policy', action: 'view' })
    callEnterpriseRuntime(event, 'aims.list', { authorization: { resource: 'permit-only', action: 'view' } })
  `
  const result = inspect('aims/server/utils/fixture.ts', code)
  assert.equal(result.findings.length, 7)
  assert.ok(result.findings.some(value => value.includes('aims:removed-resource')))
  assert.ok(result.findings.some(value => value.includes('aims:orphan')))
  assert.ok(result.findings.some(value => value.includes('aims:orphan-via-local')))
  assert.ok(result.findings.some(value => value.includes('aims:orphan-via-loop')))
  assert.ok(result.findings.some(value => value.includes('aims:orphan-command')))
  assert.ok(result.findings.some(value => value.includes('aims:orphan-evaluation')))
  assert.ok(result.findings.some(value => value.includes('aims:orphan-policy')))
  assert.ok(result.findings.every(value => !value.includes('permit-only')))
})

test('People, Finance, and Foundation product forwarding literals are checked', () => {
  const people = inspect('people/server/utils/fixture.ts', `
    assertPeoplePermission(event, 'orphan-people', 'view')
    hasPermission(snapshot, 'orphan-people-inner', 'view')
  `)
  const finance = inspect('finance/server/utils/fixture.ts', `
    loadFinanceScopedGrants(event, uid, 'orphan-finance', 'view')
  `)
  const product = inspect('aims/server/utils/fixture.ts', `
    const resourceCode = 'orphan-product'
    evaluateFoundationProductAuthorization({ required: { appCode: 'aims', resourceCode, action: 'view' } })
  `)
  assert.ok(people.findings.some(value => value.includes('people:orphan-people')))
  assert.ok(people.findings.some(value => value.includes('people:orphan-people-inner')))
  assert.ok(finance.findings.some(value => value.includes('finance:orphan-finance')))
  assert.ok(product.findings.some(value => value.includes('aims:orphan-product')))
})

test('a new variable-form personnel resource needs allowlist review', () => {
  const variable = inspect('aims/server/utils/new-forwarding.ts', `
    function check(event, resource) {
      return requirePermission(event, resource, 'view')
    }
  `)
  assert.equal(variable.findings.length, 0)
  assert.deepEqual(variable.forwarded, ['aims/server/utils/new-forwarding.ts:3:14 requirePermission'])
  assert.ok(!forwardedResourceAllowlist.includes(variable.forwarded[0]))
  const permit = inspect('aims/server/utils/permit-only.ts', `
    callEnterpriseRuntime(event, 'aims.list', { authorization: { resource: resourceCode, action: 'view' } })
  `)
  assert.deepEqual(permit.forwarded, [])
})
