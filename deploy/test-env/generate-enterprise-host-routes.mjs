import { readFileSync, writeFileSync } from 'node:fs'
import { businessModules, hostNativePages } from '../../enterprise/composition/registry.mjs'

export function renderEnterpriseHostRoutes() {
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
  for (const page of hostNativePages.filter(page => page.module === 'altoc')) {
    (routes[page.module] ||= []).push(page.path)
  }
  const body = `// Generated from enterprise/composition/registry.mjs.\nexport const enterpriseHostRoutes = Object.freeze(${JSON.stringify(routes, null, 2).replace(/"/g, "'")})\nexport const enterpriseHostEntries = Object.freeze(${JSON.stringify(entries).replace(/"/g, "'")})\n`
  return body
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = new URL('./enterprise-host-routes.mjs', import.meta.url)
  const rendered = renderEnterpriseHostRoutes()
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== rendered) {
      console.error('Host route projection drift: run node deploy/test-env/generate-enterprise-host-routes.mjs')
      process.exitCode = 1
    }
  } else writeFileSync(path, rendered)
}
