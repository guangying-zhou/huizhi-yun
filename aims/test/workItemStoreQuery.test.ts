import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(
  new URL('../app/stores/workItem.ts', import.meta.url),
  'utf8'
)

const fetchItemsSource = source.slice(
  source.indexOf('async function fetchItems'),
  source.indexOf('async function fetchBoardItems')
)

describe('work item list query serialization', () => {
  test('serializes a non-empty severity filter for the list endpoint', () => {
    assert.match(
      fetchItemsSource,
      /if \(query\?\.severity\) params\.set\('severity', query\.severity\)/
    )
  })

  test('does not serialize an empty severity filter', () => {
    const severityAssignments = [
      ...fetchItemsSource.matchAll(/params\.set\('severity', query\.severity\)/g)
    ]

    assert.equal(severityAssignments.length, 1)
    assert.match(
      fetchItemsSource,
      /if \(query\?\.severity\) params\.set\('severity', query\.severity\)/
    )
  })
})
