import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('requirement target switcher presentation boundary', () => {
  test('page retains composable, request, filters and event wiring', () => {
    const page = source('app/pages/projects/[id]/requirements/index.vue')

    assert.match(page, /useRequirementTargets<RequirementTargetInfo>\(/)
    assert.match(page, /fetchTargets: async \(currentProjectId\) =>/)
    assert.match(page, /`\/api\/v1\/projects\/\$\{currentProjectId\}\/requirement-targets`/)
    assert.match(page, /type: filters\.type/)
    assert.match(page, /search: normalizedRequirementSearch\.value \|\| undefined/)
    assert.match(page, /watch\(activeTargetId, \(\) => \{/)
    assert.match(page, /fetchRequirementTargets\(\)/)
    assert.match(page, /<RequirementTargetSwitcher/)
    assert.match(page, /:targets="requirementTargets"/)
    assert.match(page, /:active-target-id="activeTargetId"/)
    assert.match(page, /:active-target="activeTarget"/)
    assert.match(page, /:all-requirement-count="allRequirementCount"/)
    assert.match(page, /@update:active-target-id="activeTargetId = \$event"/)
  })

  test('child is a pure target switcher with all, baseline, change and milestone structure', () => {
    const switcher = source('app/components/requirements/RequirementTargetSwitcher.vue')

    assert.match(switcher, /targets: readonly RequirementTargetDisplay\[\]/)
    assert.match(switcher, /activeTargetId: number \| null/)
    assert.match(switcher, /activeTarget: RequirementTargetDisplay \| null/)
    assert.match(switcher, /allRequirementCount: number/)
    assert.match(switcher, /'update:activeTargetId': \[targetId: number \| null\]/)
    assert.match(switcher, /icon="i-lucide-folders"/)
    assert.match(switcher, /emit\('update:activeTargetId', null\)/)
    assert.match(switcher, /v-for="target in targets"/)
    assert.match(switcher, /target\.isBaseline \? 'primary' : 'warning'/)
    assert.match(switcher, /target\.isBaseline \? 'i-lucide-anchor' : 'i-lucide-file-diff'/)
    assert.match(switcher, /T\{\{ target\.taskCount \}\}\/R\{\{ target\.requirementCount \}\}/)
    assert.match(switcher, /挂载里程碑：\{\{ activeTarget\.milestoneName \|\| '-' \}\}/)
    assert.match(switcher, /\(PIVR:\{\{ activeTarget\.milestonePivrStage \}\}\)/)
    assert.match(switcher, /emit\('update:activeTargetId', target\.id\)/)
  })

  test('child has no API, routing, filter or selection lifecycle concerns', () => {
    const switcher = source('app/components/requirements/RequirementTargetSwitcher.vue')

    assert.doesNotMatch(switcher, /\$fetch|useFetch|fetch\(/)
    assert.doesNotMatch(switcher, /useRoute|useRouter|router\.|route\./)
    assert.doesNotMatch(switcher, /filters|useRequirementTargets|resolveTargetId|setWorkItemId|watch\(/)
  })
})
