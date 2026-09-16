import assert from 'node:assert/strict'
import test from 'node:test'
import { peopleEmployeeSearchRoutePolicy } from '../server/utils/peopleRuntimeRoutePolicy.ts'

test('People employee search POST is a read transport with employee view permission', () => {
  assert.deepEqual(
    peopleEmployeeSearchRoutePolicy('/employees:search', 'POST'),
    {
      transportScope: 'people.read',
      permission: {
        resource: 'employees',
        action: 'view'
      }
    }
  )
})

test('People employee search policy does not downgrade ordinary writes or other methods', () => {
  assert.equal(peopleEmployeeSearchRoutePolicy('/employees', 'POST'), null)
  assert.equal(peopleEmployeeSearchRoutePolicy('/employees:search', 'PATCH'), null)
  assert.equal(peopleEmployeeSearchRoutePolicy('/employees:search', 'GET'), null)
})
