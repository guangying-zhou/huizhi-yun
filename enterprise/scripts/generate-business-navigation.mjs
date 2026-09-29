import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildBusinessNavigation, buildObjectWorkspaces, businessModules, navigationContributors, hostNativePages, navigationSources, registerBusinessPages } from '../composition/registry.mjs'
import { auxiliaryAreas, businessAreas } from '../composition/business-areas.mjs'

function flattenPages(page, parent = '') {
  const path = page.path.startsWith('/') ? page.path : `${parent}/${page.path}`.replace(/\/$/, '')
  return [{ path, name: page.name }, ...(page.children || []).flatMap(child => flattenPages(child, path))]
}

const output = fileURLToPath(new URL('../app/utils/enterprise-navigation.ts', import.meta.url))
const registered = registerBusinessPages([], businessModules, fileURLToPath(new URL('../app/module-entry.vue', import.meta.url)))
const navigation = {
  businessNavigation: buildBusinessNavigation(navigationContributors, businessAreas, auxiliaryAreas),
  objectWorkspaces: buildObjectWorkspaces(businessModules),
  registeredPages: [...registered.flatMap(page => flattenPages(page)), ...hostNativePages.map(({ path, name }) => ({ path, name }))],
  navigationSources
}
writeFileSync(output, `// Generated from the composition registry; do not edit by hand.\nexport const enterpriseNavigation = ${JSON.stringify(navigation, null, 2)} as const\n`)
