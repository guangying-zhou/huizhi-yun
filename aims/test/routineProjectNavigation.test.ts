import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getProjectMenuItems } from '../app/config/navigation.ts'

describe('routine project navigation', () => {
  test('only exposes the views used by routine work', () => {
    const items = getProjectMenuItems(258, 'routine')

    assert.deepEqual(
      items.map(item => ({ label: item.label, to: item.to })),
      [
        { label: '概览', to: '/projects/258' },
        { label: '工作项', to: '/projects/258/board' },
        { label: '工时', to: '/projects/258/timesheet' }
      ]
    )
  })

  test('keeps the standard project menu unchanged', () => {
    const labels = getProjectMenuItems(258, 'custom_dev').map(item => item.label)

    assert.deepEqual(labels, ['概览', '里程碑', '目标', '任务', '文档', '成果', '工时', '度量'])
  })
})
