import { writeFileSync } from 'node:fs'
import { businessModules } from '../../enterprise/composition/registry.mjs'

const routes = {}
const entries = {}
for (const module of businessModules) {
  entries[module.code] = `${module.prefix}${module.hostReadiness?.entryPath || '/'}`
  const paths = []
  const collect = (pages, parent = module.prefix) => {
    for (const page of pages || []) {
      const full = page.path.startsWith('/') ? `${module.prefix}${page.path}` : `${parent}/${page.path}`.replace(/\/+/g, '/')
      paths.push(full.replace(/\/$/, '') || module.prefix)
      collect(page.children, full)
    }
  }
  collect(module.pages)
  routes[module.code] = [...new Set(paths)]
}
const body = `// Generated from enterprise/composition/registry.mjs.\nexport const enterpriseHostRoutes = Object.freeze(${JSON.stringify(routes, null, 2).replace(/"/g, "'")})\nexport const enterpriseHostEntries = Object.freeze(${JSON.stringify(entries).replace(/"/g, "'")})\n`
writeFileSync(new URL('./enterprise-host-routes.mjs', import.meta.url), body)
