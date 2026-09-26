import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildBusinessNavigation, buildObjectWorkspaces, businessModules } from '../source/enterprise/composition/registry.mjs'
import { businessAreas, auxiliaryAreas } from '../source/enterprise/composition/business-areas.mjs'
import { resolveEnterprisePilotPath } from '../source/deploy/test-env/enterprise-topology.mjs'

const nav = buildBusinessNavigation(businessModules, businessAreas, auxiliaryAreas)
const areas = [...nav.primary, ...nav.auxiliary]
const leaves = areas.flatMap(a => a.children.flatMap(g => g.children))
const workspaces = buildObjectWorkspaces(businessModules)
const layout = readFileSync(new URL('../source/enterprise/app/layouts/default.vue', import.meta.url), 'utf8')
const matcherBody = layout.match(/const objectMode = computed\(\(\) => \{([\s\S]*?)\n\}\)/)?.[1]
assert.ok(matcherBody, 'exact objectMode body must be extractable')
// Execute the exact JavaScript body extracted from the verified Vue source.
// No Nuxt/Vue runtime is simulated; route.path and declared workspaces are inputs.
const matchObject = new Function('route', 'workspaces', matcherBody)
const observations = {
  snapshot: '0ca042dbe721e7ba72a290a7d90a551d561e4d04',
  declaredAreas: [...businessAreas,...auxiliaryAreas].map(a=>a.label),
  generatedAreas: areas.map(a=>a.label),
  generatedLeaves: leaves,
  leafCount: leaves.length,
  leafPropertySets: [...new Set(leaves.map(a=>Object.keys(a).sort().join(',')))],
  objectMatches: {},
  shortcutDuplicateOutcome: null,
  projectObjectDestinations: workspaces[0].groups.flatMap(g=>g.items.map(i=>workspaces[0].base+i.path)),
  formerShellRoute: resolveEnterprisePilotPath('/shell/aims'),
  innerMigratedRoute: resolveEnterprisePilotPath('/aims/products'),
}
for (const path of ['/aims/projects', '/aims/projects/new', '/aims/projects/42', '/aims/projects/42/plan']) {
  const match = matchObject({ path }, workspaces)
  observations.objectMatches[path] = match ? {
    objectPath: match.objectPath,
    returnTarget: match.workspace.backTo,
    targets: match.workspace.groups.flatMap(g=>g.items.map(i=>match.objectPath+i.path))
  } : null
}
const [aims, assets] = businessModules
try {
  buildBusinessNavigation([{...aims, navigation:[...aims.navigation,{area:'product',group:'rnd',label:'研发项目快捷入口',to:'/aims/projects'}]},assets],businessAreas,auxiliaryAreas)
  observations.shortcutDuplicateOutcome = 'accepted'
} catch (e) {
  observations.shortcutDuplicateOutcome = e.message
}
assert.deepEqual(observations.generatedAreas, ['产品','交付与服务','经营','控制台'])
assert.equal(observations.leafCount, 12)
assert.equal(observations.objectMatches['/aims/projects/new'].objectPath, '/aims/projects/new')
assert.ok(observations.objectMatches['/aims/projects/new'].targets.includes('/aims/projects/new/plan'))
assert.equal(observations.formerShellRoute, null)
assert.match(observations.shortcutDuplicateOutcome, /appears twice/)
writeFileSync(new URL('../results/observations.json', import.meta.url), JSON.stringify(observations,null,2)+'\n')
console.log(JSON.stringify(observations,null,2))
