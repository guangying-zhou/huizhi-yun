import { createHash } from 'node:crypto'

type RecordValue = Record<string, unknown>
export interface CompositionModule { appCode: string, manifest: RecordValue }

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as RecordValue
}
function fail(): never {
  throw Object.assign(new Error('Invalid enterprise manifest composition'), { statusCode: 400 })
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as RecordValue)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function hash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** Validate the generated catalog; owning module materializers retain responsibility
 * for resource/action/role validation. No permissions are translated to enterprise. */
export function enterpriseCompositionModules(appCode: string, manifest: RecordValue): CompositionModule[] {
  if (manifest.appCode !== undefined && manifest.appCode !== appCode) fail()
  if (!Object.hasOwn(manifest, 'composition')) return []
  const composition = record(manifest.composition)
  if (appCode !== 'enterprise' || composition.schemaVersion !== 1
    || composition.kind !== 'hzy-enterprise-composition'
    || composition.registrationMode !== 'preserve-logical-module-manifests'
    || !Array.isArray(manifest.resources) || manifest.resources.length
    || !Array.isArray(manifest.recommendedRoles) || manifest.recommendedRoles.length
    || !Array.isArray(composition.modules) || !composition.modules.length) fail()
  const seen = new Set<string>()
  const modules = composition.modules.map((value): CompositionModule => {
    const entry = record(value), module = record(entry.manifest)
    if (typeof entry.appCode !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.appCode)
      || ['enterprise', 'platform', 'console', 'account'].includes(entry.appCode)
      || seen.has(entry.appCode) || module.appCode !== entry.appCode
      || module.appType !== 'business' || Object.hasOwn(module, 'composition')
      || !Array.isArray(module.resources) || !Array.isArray(module.recommendedRoles)
      || entry.manifestHash !== hash(module)) fail()
    seen.add(entry.appCode)
    return { appCode: entry.appCode, manifest: module }
  }).sort((a, b) => a.appCode.localeCompare(b.appCode))
  if (!seen.has('aims') || !seen.has('assets')) fail()
  const resources = modules.flatMap(module => (module.manifest.resources as unknown[])
    .map((resource): RecordValue & { appCode: string } => ({ ...record(resource), appCode: module.appCode })))
    .sort((a, b) => `${a.appCode}:${a.code}`.localeCompare(`${b.appCode}:${b.code}`))
  const roles: Array<RecordValue & { appCode: string }> = modules.flatMap(({ appCode, manifest }) => (manifest.recommendedRoles as unknown[])
    .map((role): RecordValue & { appCode: string } => ({ ...record(role), appCode })))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
  const catalog = {
    permissionCodes: resources.flatMap(resource => Array.isArray(resource.actions)
      ? resource.actions.map(action => `${resource.appCode}:${resource.code}:${action}`)
      : []).sort(),
    resources,
    roles,
    modules: modules.map(({ appCode, manifest }) => ({ appCode,
      actionImplications: manifest.actionImplications || {}, supportedScopes: manifest.supportedScopes || [] }))
  }
  if (composition.permissionCatalogHash !== hash(catalog)
    || canonical(composition.permissionCatalog) !== canonical(catalog)) fail()
  return modules
}
