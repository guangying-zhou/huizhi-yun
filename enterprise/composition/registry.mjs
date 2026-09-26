import aims from '../../aims/layer/entry.mjs'
import assets from '../../assets/layer/entry.mjs'
import codocs from '../../codocs/layer/entry.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const manifestFor = code => JSON.parse(readFileSync(fileURLToPath(new URL(`../../${code}/app.manifest.json`, import.meta.url)), 'utf8'))
const permissionCatalogs = new Map([aims, assets, codocs].map(module => {
  const manifest = manifestFor(module.code)
  const permissions = new Set((manifest.resources || []).flatMap(resource =>
    (resource.actions || []).map(action => `${manifest.appCode}:${resource.code}:${action}`)))
  return [module.code, permissions]
}))

function validatePermissions(module, permission, permissionRefs, mode) {
  const refs = permissionRefs || (permission ? [permission] : [])
  if (!refs.length || (permissionRefs && permission)) throw Error(`Business menu item ${module.code} must declare permission or permissionRefs, not both`)
  if (mode !== undefined && mode !== 'all' && mode !== 'any') throw Error(`Invalid business menu permission mode: ${mode}`)
  if (refs.length > 1 && mode !== 'all' && mode !== 'any') throw Error(`Business menu item ${module.code} must declare permission mode for multiple conditions`)
  const normalized = refs.map(ref => {
    if (!ref || typeof ref !== 'object' || typeof ref.resource !== 'string' || typeof ref.action !== 'string') {
      throw Error(`Business menu item ${module.code} must declare permission { resource, action }`)
    }
    const code = `${module.code}:${ref.resource}:${ref.action}`
    if (!permissionCatalogs.get(module.code)?.has(code)) throw Error(`Business menu permission is not in manifest: ${code}`)
    return Object.freeze({ resource: ref.resource, action: ref.action })
  })
  return normalized.length === 1 && !permissionRefs
    ? { permission: normalized[0] }
    : { permissionRefs: Object.freeze(normalized), mode }
}

export const businessModules = Object.freeze([aims, assets, codocs])

export function registerBusinessPages(existing, modules, placeholderFile) {
  const paths = new Set(existing.map(page => page.path))
  const names = new Set(existing.map(page => page.name).filter(Boolean))
  const registered = []
  for (const module of modules) {
    if (!/^[a-z][a-z0-9-]*$/.test(module.code) || module.prefix !== `/${module.code}`) throw Error('Invalid business module prefix')
    const pages = [{ path: '', name: 'index', file: placeholderFile }, ...module.pages]
    const register = (page, parentPath, nested = false) => {
      if ((!nested && page.path && !page.path.startsWith('/')) || (nested && page.path.startsWith('/')) || page.path.includes('..') || page.path.includes('?') || page.path.includes('#')) throw Error('Invalid business page path')
      const fullPath = nested ? `${parentPath}/${page.path}`.replace(/\/$/, '') : `${module.prefix}${page.path}`
      const name = `${module.code}-${page.name}`
      // An index child deliberately shares its parent's URL, but never a route name.
      if ((!(nested && page.path === '') && paths.has(fullPath)) || names.has(name)) throw Error(`Duplicate business route: ${fullPath}`)
      paths.add(fullPath)
      names.add(name)
      return {
        path: nested ? page.path : fullPath,
        name,
        file: page.file,
        meta: {
          layout: 'enterprise',
          logicalModule: module.code,
          moduleLabel: module.label,
          moduleEntryPath: module.hostReadiness?.entryPath || '/products'
        },
        ...(page.children ? { children: page.children.map(child => register(child, fullPath, true)) } : {})
      }
    }
    registered.push(...pages.map(page => register(page, '')))
  }
  return registered
}

// buildBusinessNavigation composes one business-area menu out of what every
// module contributes. Areas come from ADR-019 §4.1, modules supply only their
// third-level pages, and a group or area nobody contributed to is dropped —
// the specification refuses empty entries that pretend a feature exists.
// Every target must resolve to a registered page of the contributing module, so
// a menu entry can never point at a route the Host does not serve.
export function buildBusinessNavigation(modules, areas, auxiliary) {
  const contributed = new Map()
  const destinationPermissions = new Map()
  for (const module of modules) {
    const concrete = new Set([module.prefix])
    const collect = (pages, parent = '') => {
      for (const page of pages) {
        const full = page.path.startsWith('/') ? `${module.prefix}${page.path}` : `${parent}/${page.path}`.replace(/\/$/, '')
        if (!full.includes(':') && !full.includes('*')) concrete.add(full)
        if (page.children) collect(page.children, full)
      }
    }
    collect(module.pages)
    for (const item of module.navigation || []) {
      if (!item.to.startsWith(`${module.prefix}/`) && item.to !== module.prefix) {
        throw Error(`Business menu target outside ${module.code}: ${item.to}`)
      }
      if (!concrete.has(item.to)) throw Error(`Business menu target is not a registered page: ${item.to}`)
      const key = `${item.area}/${item.group}`
      if (!contributed.has(key)) contributed.set(key, [])
      if (!item.id || typeof item.id !== 'string') throw Error(`Business menu item in ${module.code} must declare a stable id`)
      const permission = validatePermissions(module, item.permission, item.permissionRefs, item.mode)
      const signature = JSON.stringify({ module: module.code, mode: permission.mode || 'all', refs: (permission.permissionRefs || [permission.permission]).map(ref => `${ref.resource}:${ref.action}`).sort() })
      if (destinationPermissions.has(item.to) && destinationPermissions.get(item.to) !== signature) throw Error(`Business menu aliases must share destination permissions: ${item.to}`)
      destinationPermissions.set(item.to, signature)
      contributed.get(key).push({ id: item.id, label: item.label, to: item.to, order: item.order ?? 0, module: module.code, ...permission })
    }
  }
  const seen = new Set()
  const compose = list => list.flatMap((area) => {
    const areaId = area.code
    if (seen.has(areaId)) throw Error(`Duplicate business menu node id: ${areaId}`)
    seen.add(areaId)
    const groups = area.groups.flatMap((group) => {
      const pages = (contributed.get(`${area.code}/${group.code}`) || [])
        .sort((a, b) => (a.order === b.order ? a.label.localeCompare(b.label) : a.order - b.order))
      if (!pages.length) return []
      const groupId = `${area.code}.${group.code}`
      if (seen.has(groupId)) throw Error(`Duplicate business menu node id: ${groupId}`)
      seen.add(groupId)
      for (const page of pages) {
        if (seen.has(page.id)) throw Error(`Duplicate business menu node id: ${page.id}`)
        seen.add(page.id)
      }
      return [{ id: groupId, code: group.code, label: group.label, icon: group.icon, children: pages.map(page => {
        const { id, label, to, module, permission, permissionRefs, mode } = page
        return { id, label, to, module, ...(permission ? { permission } : { permissionRefs, mode }) }
      }) }]
    })
    return groups.length ? [{ id: area.code, code: area.code, label: area.label, icon: area.icon, children: groups }] : []
  })
  const unknown = [...contributed.keys()].filter(key => ![...areas, ...auxiliary]
    .some(area => area.groups.some(group => `${area.code}/${group.code}` === key)))
  if (unknown.length) throw Error(`Business menu targets an area/group that does not exist: ${unknown.join(', ')}`)
  return { primary: compose(areas), auxiliary: compose(auxiliary) }
}

// buildObjectWorkspaces exposes the object-mode navigation a module declares for
// its complex objects. Paths are relative to the object root so one declaration
// serves every instance, and each resolved pattern must be a registered route —
// an object menu must not offer a page the Host does not serve.
export function buildObjectWorkspaces(modules) {
  const workspaces = []
  // Runtime visibility is a single set of IDs, so an object action must never
  // alias a differently-authorized global leaf or parent from another tree.
  const ids = new Set(modules.flatMap(module => (module.navigation || [])
    .flatMap(item => [item.id, item.area, `${item.area}.${item.group}`])))
  for (const module of modules) {
    for (const workspace of module.objectWorkspaces || []) {
      if (ids.has(workspace.code)) throw Error(`Duplicate business menu node id: ${workspace.code}`)
      ids.add(workspace.code)
      if (!workspace.base.startsWith(`${module.prefix}/`)) {
        throw Error(`Object workspace outside ${module.code}: ${workspace.base}`)
      }
      const patterns = new Set()
      const collect = (pages, parent = '') => {
        for (const page of pages) {
          const full = page.path.startsWith('/') ? `${module.prefix}${page.path}` : `${parent}/${page.path}`.replace(/\/$/, '')
          patterns.add(full)
          if (page.children) collect(page.children, full)
        }
      }
      collect(module.pages)
      for (const group of workspace.groups) {
        if (!group.id || typeof group.id !== 'string') throw Error(`Object workspace group in ${module.code} must declare a stable id`)
      }
      const groups = workspace.groups.map(group => ({
        id: `${workspace.code}.${group.id}`,
        label: group.label,
        items: group.items.map((item) => {
          const pattern = `${workspace.base}${item.path}`
          if (!patterns.has(pattern)) throw Error(`Object menu target is not a registered page: ${pattern}`)
          if (!item.id || typeof item.id !== 'string') throw Error(`Object workspace item in ${module.code} must declare a stable id`)
          if (ids.has(item.id)) throw Error(`Duplicate business menu node id: ${item.id}`)
          ids.add(item.id)
          return { id: item.id, label: item.label, path: item.path, module: module.code, ...validatePermissions(module, item.permission, item.permissionRefs, item.mode) }
        })
      }))
      for (const group of groups) {
        if (ids.has(group.id)) throw Error(`Duplicate business menu node id: ${group.id}`)
        ids.add(group.id)
      }
      const actions = (workspace.actions || []).map(item => {
        if (!item.id || ids.has(item.id)) throw Error(`Duplicate or missing object action id: ${item.id}`)
        ids.add(item.id)
        return { id: item.id, module: module.code, ...validatePermissions(module, item.permission, item.permissionRefs, item.mode) }
      })
      workspaces.push({ ...workspace, groups, actions })
    }
  }
  return workspaces
}
