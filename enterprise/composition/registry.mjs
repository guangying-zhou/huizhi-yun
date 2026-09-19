import aims from '../../aims/layer/entry.mjs'
import assets from '../../assets/layer/entry.mjs'

export const businessModules = Object.freeze([aims, assets])

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
      contributed.get(key).push({ label: item.label, to: item.to, order: item.order ?? 0, module: module.code })
    }
  }
  const seen = new Set()
  const compose = list => list.flatMap((area) => {
    const groups = area.groups.flatMap((group) => {
      const pages = (contributed.get(`${area.code}/${group.code}`) || [])
        .sort((a, b) => (a.order === b.order ? a.label.localeCompare(b.label) : a.order - b.order))
      if (!pages.length) return []
      for (const page of pages) {
        if (seen.has(page.to)) throw Error(`Business menu target appears twice: ${page.to}`)
        seen.add(page.to)
      }
      return [{ code: group.code, label: group.label, icon: group.icon, children: pages.map(({ label, to }) => ({ label, to })) }]
    })
    return groups.length ? [{ code: area.code, label: area.label, icon: area.icon, children: groups }] : []
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
  for (const module of modules) {
    for (const workspace of module.objectWorkspaces || []) {
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
      const groups = workspace.groups.map(group => ({
        label: group.label,
        items: group.items.map((item) => {
          const pattern = `${workspace.base}${item.path}`
          if (!patterns.has(pattern)) throw Error(`Object menu target is not a registered page: ${pattern}`)
          return { label: item.label, path: item.path }
        })
      }))
      workspaces.push({ ...workspace, groups })
    }
  }
  return workspaces
}
