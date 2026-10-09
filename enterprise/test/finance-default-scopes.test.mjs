import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseManifestDefaultScopes } from '../../platform/server/utils/appManifestDefaultScopes.ts'
import { parseManifestPermissionString } from '../../platform/server/utils/appManifestPermission.ts'
import { buildPolicyBundleV2CompatFields } from '../../platform/server/utils/policyBundleV2.ts'

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(new URL('../../finance/app.manifest.json', import.meta.url), 'utf8'))

test('Finance manifest defaults survive bundle projection and enforce BFF all/self/none without extra actions', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000;export const callEnterpriseRuntime=async(...args)=>{globalThis.__defaultCalls.push(args);return {code:0,data:{data:[]}}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,appCode)=>({uid,appCode,bundleVersion:'1',bundleHash:'hash',policyRevision:40,authorizationExpiresAt:Date.now()+10000,grants:globalThis.__defaultGrants,actionPolicy:globalThis.__defaultPolicy})`
    if (specifier.endsWith('/directoryApi')) source = `export const fetchDirectoryActiveStatuses=async()=>[]`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  globalThis.__defaultCalls = []
  try {
    const { buildScopedAuthorizationGrantsFromPolicyBundle, buildPolicyBundleActionPolicy } = await import('../../foundation/server/utils/applicationAuthorization.ts')
    const { authorizeFinanceLedger, normalizeFinanceLedgerRequest } = await import('../server/utils/enterpriseFinanceLedger.ts')
    const event = { node: { res: { setHeader: () => {} }, req: { headers: { 'idempotency-key': 'intent' } } } }
    const { resolveFinanceResponsibilityAccessFromGrants, financeProjectAccountingScopeQuery } = await import('../../finance/server/utils/financeScopedAuthorization.ts')
    for (const [roleCode, expected] of [['finance:admin', 'all'], ['finance:manager', 'all'], ['finance:expense_submitter', 'self'], ['finance:viewer', 'none']]) {
      const role = manifest.recommendedRoles.find(row => row.code === roleCode)
      const permissions = role.suggestedPermissions.map((value, index) => parseManifestPermissionString(value, 'finance', roleCode, index))
      const defaults = parseManifestDefaultScopes(role, permissions, manifest.supportedScopes)
      const projected = buildPolicyBundleV2CompatFields({ tenantCode: 'C000001', environment: 'test', subjectRoles: [{ assignmentId: 1, subjectType: 'user', subjectCode: 'subject', roleCode: 'custom-finance', status: 'active' }], subjectRoleScopes: [], baselinePermissions: [], conflictRules: [], rolePermissions: permissions.map(row => ({ ...row, roleCode: 'custom-finance', status: 'active', sourceType: 'app_role', appRoleCode: roleCode })), roleScopes: (defaults || []).map(row => ({ ...row, roleCode: 'custom-finance', status: 'active', sourceType: 'app_role', appRoleCode: roleCode })) })
      assert.equal(projected.roleDefaultScopes.length, defaults.length)
      const payload = { ...projected, subjects: [{ subjectType: 'user', subjectCode: 'subject', externalRef: 'actor', status: 'active' }], roles: [{ roleCode: 'custom-finance', appCode: null, isAssignable: 1, status: 'active' }] }
      const { grants } = buildScopedAuthorizationGrantsFromPolicyBundle({ payload, uid: 'actor' })
      assert.equal(grants.length, permissions.length)
      const policy = buildPolicyBundleActionPolicy(payload, 'finance', 'expenses')
      globalThis.__defaultGrants = grants
      globalThis.__defaultPolicy = policy
      const input = normalizeFinanceLedgerRequest('expenses-page', undefined, {}, {})
      const count = globalThis.__defaultCalls.length
      if (expected === 'none') await assert.rejects(authorizeFinanceLedger(event, 'expenses-page', input), { statusCode: 403 })
      else {
        const result = await authorizeFinanceLedger(event, 'expenses-page', input)
        assert.equal(result.authorization.scope.access, expected)
      }
      assert.equal(globalThis.__defaultCalls.length, count, 'authorization never calls the owning operation itself')
      const accounting = financeProjectAccountingScopeQuery({ grants, actionPolicy: policy }, 'view')
      assert.equal(accounting.current_user_project_finance_access, expected === 'all' ? 'all' : 'none')
      for (const resource of ['invoices', 'receipts', 'reconciliation']) {
        assert.equal(resolveFinanceResponsibilityAccessFromGrants(grants, resource, 'view', policy), expected === 'all' ? 'all' : 'none', resource)
      }
      if (roleCode === 'finance:manager') await assert.rejects(authorizeFinanceLedger(event, 'claims-confirm', input), { statusCode: 403 }, 'global data scope adds no confirm action')
      if (roleCode === 'finance:admin') {
        const tightened = grants.map(grant => ({ ...grant, assignmentScopes: [{ dimension: 'subject', predicate: 'self' }] }))
        assert.equal(resolveFinanceResponsibilityAccessFromGrants(tightened, 'expenses', 'view', policy), 'relation', 'assignment scope still intersects defaults')
        const expired = { ...payload, roleAssignments: payload.roleAssignments.map(row => ({ ...row, expiresAt: '2000-01-01T00:00:00Z' })) }
        assert.equal(buildScopedAuthorizationGrantsFromPolicyBundle({ payload: expired, uid: 'actor' }).grants.length, 0, 'expired assignment cannot inherit defaults')
        const combined = {
          ...payload,
          roles: [...payload.roles, { roleCode: 'readonly', appCode: null, isAssignable: 1, status: 'active' }],
          roleAssignments: [...payload.roleAssignments, { assignmentId: 2, subjectType: 'user', subjectCode: 'subject', roleCode: 'readonly', status: 'active' }],
          rolePermissionGrants: [...payload.rolePermissionGrants, { roleCode: 'readonly', appCode: 'finance', resourceCode: 'expenses', action: 'view', status: 'active' }]
        }
        const merged = buildScopedAuthorizationGrantsFromPolicyBundle({ payload: combined, uid: 'actor' }).grants
        assert.equal(resolveFinanceResponsibilityAccessFromGrants(merged, 'expenses', 'view', policy), 'all', 'normal mode merges valid grants')
        const simulated = buildScopedAuthorizationGrantsFromPolicyBundle({ payload: combined, uid: 'actor', authorizationMode: 'role_simulation', requestedRoleCode: 'readonly', allowRoleSimulation: true }).grants
        assert.equal(resolveFinanceResponsibilityAccessFromGrants(simulated, 'expenses', 'view', policy), 'none', 'viewer simulation cannot inherit real admin defaults')
        const unrelated = grants.map(grant => ({ ...grant, assignmentScopes: [{ dimension: 'department', predicate: 'tree', value: 'D1' }] }))
        assert.equal(resolveFinanceResponsibilityAccessFromGrants(unrelated, 'expenses', 'view', policy), 'none', 'unsupported department transport cannot become all')
      }
    }
  } finally {
    hooks.deregister()
    delete globalThis.__defaultCalls
    delete globalThis.__defaultGrants
    delete globalThis.__defaultPolicy
  }
})
