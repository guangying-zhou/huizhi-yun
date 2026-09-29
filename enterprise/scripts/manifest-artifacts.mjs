import { createHash } from 'node:crypto'
// Console activation and the Gateway's registered-page projection are part of
// the Host navigation contract, not independently replaceable release inputs.
export const releaseSourcePaths = ['enterprise', 'aims', 'assets', 'codocs', 'altoc', 'foundation', 'console', 'deploy/cloudflare/tenant-gateway', 'platform/packages', 'data-runtime']
export const releaseBuildFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'deploy/test-env/enterprise-host-routes.mjs', 'deploy/test-env/enterprise-topology.mjs']
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex') }
export function canonicalGeneration(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) throw Error('Invalid uint64 generation')
  return value
}
function required(value, name, pattern = /\S/) {
  if (typeof value !== 'string' || !pattern.test(value) || /^(unknown|pending|todo|dev|latest)$/i.test(value)) throw Error(`Missing or invalid ${name}`)
  return value
}
export function catalogHasStablePermission(catalog, permission) {
  return typeof permission === 'string' && Array.isArray(catalog?.permissionCodes) && catalog.permissionCodes.includes(permission)
}
export function composeManifest(manifests) {
  const apps = new Set(), permissions = new Set(), resources = [], roles = [], roleCodes = new Set()
  for (const manifest of manifests) {
    const app = required(manifest.appCode, 'module appCode', /^[a-z][a-z0-9-]*$/)
    if (apps.has(app)) throw Error(`Duplicate module ${app}`)
    apps.add(app)
    const codes = new Set()
    for (const resource of manifest.resources || []) {
      const code = required(resource.code, 'resource code', /^[a-z][a-z0-9_-]*$/)
      if (codes.has(code)) throw Error(`Duplicate resource ${app}:${code}`)
      codes.add(code)
      const actions = new Set()
      for (const action of resource.actions || []) {
        // Preserve existing compound actions such as Altoc finance-summary:sync.
        required(action, 'action', /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)*$/)
        if (actions.has(action)) throw Error(`Duplicate action ${app}:${code}:${action}`)
        actions.add(action); permissions.add(`${app}:${code}:${action}`)
      }
      resources.push({ ...resource, appCode: app })
    }
    for (const role of manifest.recommendedRoles || []) {
      const roleCode = required(role.code, 'role code', new RegExp(`^${app}:[a-z][a-z0-9_-]*$`))
      if (roleCodes.has(roleCode)) throw Error(`Duplicate role ${roleCode}`)
      roleCodes.add(roleCode)
      const rolePermissions = new Set()
      for (const permission of role.suggestedPermissions || []) {
        required(permission, 'role permission', /^[a-z][a-z0-9-]*:[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)*$/)
        if (rolePermissions.has(permission)) throw Error(`Duplicate role permission ${roleCode}:${permission}`)
        rolePermissions.add(permission)
        if (!permission.startsWith(`${app}:`) || !permissions.has(permission)) throw Error(`Undefined role permission ${permission}`)
      }
      roles.push({ ...role, code: roleCode, appCode: app, suggestedPermissions: [...(role.suggestedPermissions || [])] })
    }
  }
  if (!apps.has('aims') || !apps.has('assets') || !apps.has('codocs')) throw Error('Aims, Assets and Codocs manifests are required')
  const catalog = {
    permissionCodes: [...permissions].sort(),
    resources: resources.sort((a,b) => `${a.appCode}:${a.code}`.localeCompare(`${b.appCode}:${b.code}`)),
    roles: roles.sort((a,b) => a.code.localeCompare(b.code)),
    modules: manifests.map(m => ({ appCode: m.appCode, actionImplications: m.actionImplications || {}, supportedScopes: m.supportedScopes || [] })).sort((a,b) => a.appCode.localeCompare(b.appCode))
  }
  return {
    appCode: 'enterprise', appName: '汇智云企业应用', appType: 'business',
    entry: { web: '/', apiBase: '/api' },
    resources: [], recommendedRoles: [],
    composition: {
      schemaVersion: 1, kind: 'hzy-enterprise-composition',
      registrationMode: 'preserve-logical-module-manifests',
      modules: manifests.map(manifest => ({ appCode: manifest.appCode, manifestHash: digest(manifest), manifest })).sort((a,b) => a.appCode.localeCompare(b.appCode)),
      permissionCatalog: catalog, permissionCatalogHash: digest(catalog)
    }
  }
}
export function buildReleaseManifest(input, appManifest) {
  const sha = /^[a-f0-9]{40}$/
  required(input.hostTag, 'hostTag', /^enterprise\/v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/)
  for (const module of releaseSourcePaths) {
    required(input.sources?.[module]?.commit, `${module} commit`, sha)
    required(input.sources?.[module]?.tree, `${module} tree`, sha)
  }
  for (const file of releaseBuildFiles) required(input.buildFiles?.[file]?.blob, `${file} Git blob`, sha)
  required(input.runtime?.version, 'runtime version')
  required(input.runtime?.artifactSha256, 'runtime artifactSha256', /^[a-f0-9]{64}$/)
  required(input.schema?.version, 'schema version')
  required(input.schema?.manifestSha256, 'schema manifestSha256', /^[a-f0-9]{64}$/)
  required(input.paths?.registryVersion, 'path registryVersion')
  required(input.paths?.registrySha256, 'path registrySha256', /^[a-f0-9]{64}$/)
  const pathGeneration = canonicalGeneration(input.paths?.generation)
  const ownershipGeneration = canonicalGeneration(input.tasks?.ownershipGeneration)
  if (!Number.isFinite(Date.parse(input.builtAt))) throw Error('Missing build timestamp')
  if (appManifest.composition.permissionCatalogHash !== digest(appManifest.composition.permissionCatalog)) throw Error('Permission catalog hash mismatch')
  return { ...input, paths: { ...input.paths, generation: pathGeneration }, tasks: { ...input.tasks, ownershipGeneration }, schemaVersion: 1, applicationManifestSha256: digest(appManifest), permissionCatalogHash: appManifest.composition.permissionCatalogHash }
}
