import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ref } from 'vue'
import { useRequirementTargets } from '../app/composables/useRequirementTargets.ts'
import {
  requirementTargetFilterValue,
  resolveRequirementTargetId
} from '../app/utils/requirementsTargetSelection.ts'

interface Target {
  id: number
  milestoneId: number | null
  label: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('useRequirementTargets', () => {
  test('does not let an older target response overwrite a newer request', async () => {
    const first = deferred<readonly Target[] | null>()
    const second = deferred<readonly Target[] | null>()
    const responses = [first, second]
    const workItemFilters: string[] = []
    const selection = useRequirementTargets<Target>({
      projectId: ref(7),
      activeMilestoneId: ref(2),
      fetchTargets: async () => responses.shift()!.promise,
      resolveTargetId: resolveRequirementTargetId,
      setWorkItemId: targetId => workItemFilters.push(requirementTargetFilterValue(targetId))
    })

    const olderRequest = selection.refresh()
    const newerRequest = selection.refresh()
    second.resolve([{ id: 22, milestoneId: 2, label: 'new' }])
    await newerRequest
    first.resolve([{ id: 11, milestoneId: 1, label: 'old' }])
    await olderRequest

    assert.deepEqual(selection.targets.value.map(target => target.id), [22])
    assert.equal(selection.activeTargetId.value, 22)
    assert.equal(workItemFilters.at(-1), '22')
  })

  test('converges an unavailable target to the active milestone then clears it', async () => {
    const responses: Array<readonly Target[] | null> = [
      [
        { id: 11, milestoneId: 1, label: 'older milestone' },
        { id: 22, milestoneId: 2, label: 'active milestone' }
      ],
      []
    ]
    const workItemFilters: string[] = []
    const selection = useRequirementTargets<Target>({
      projectId: 7,
      activeMilestoneId: 2,
      initialTargetId: 999,
      fetchTargets: async () => responses.shift()!,
      resolveTargetId: resolveRequirementTargetId,
      setWorkItemId: targetId => workItemFilters.push(requirementTargetFilterValue(targetId))
    })

    await selection.refresh()
    assert.equal(selection.activeTargetId.value, 22)
    assert.equal(workItemFilters.at(-1), '22')

    await selection.refresh()
    assert.equal(selection.activeTargetId.value, null)
    assert.equal(workItemFilters.at(-1), '')
  })

  test('synchronizes the requirements filter when a user selects another target', async () => {
    const workItemFilters: string[] = []
    const selection = useRequirementTargets<Target>({
      projectId: 7,
      activeMilestoneId: 1,
      fetchTargets: async () => [
        { id: 11, milestoneId: 1, label: 'baseline' },
        { id: 22, milestoneId: 1, label: 'change' }
      ],
      resolveTargetId: resolveRequirementTargetId,
      setWorkItemId: targetId => workItemFilters.push(requirementTargetFilterValue(targetId))
    })

    await selection.refresh()
    selection.activeTargetId.value = 22
    assert.equal(workItemFilters.at(-1), '22')

    selection.activeTargetId.value = null
    assert.equal(workItemFilters.at(-1), '')
  })
})
