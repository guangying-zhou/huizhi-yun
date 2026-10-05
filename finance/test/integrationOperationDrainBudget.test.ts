import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFinanceDrainBudget } from '../server/utils/integrationOperationDrainBudget.ts'

test('Finance drain only claims while at least 25 seconds remain', () => {
  let current = 0
  const budget = createFinanceDrainBudget({
    maxClaims: 20,
    maxWallTimeMs: 45_000,
    claimReserveMs: 25_000,
    now: () => current
  })
  assert.equal(budget.canClaim(), true)
  budget.recordClaim()
  current = 10_000
  assert.equal(budget.canClaim(), true)
  budget.recordClaim()
  current = 20_000
  assert.equal(budget.canClaim(), true, 'exactly 25 seconds remaining may claim')
  budget.recordClaim()
  current = 20_001
  assert.equal(budget.canClaim(), false)
  assert.equal(budget.claimed(), 3)
  assert.equal(budget.stoppedBy(false), 'max_wall_time')
})

test('Finance drain budget also stops at max claims and validates unsafe budgets', () => {
  const budget = createFinanceDrainBudget({ maxClaims: 2, maxWallTimeMs: 45_000, claimReserveMs: 25_000, now: () => 0 })
  budget.recordClaim()
  budget.recordClaim()
  assert.equal(budget.canClaim(), false)
  assert.equal(budget.stoppedBy(false), 'max_claims')
  assert.equal(budget.stoppedBy(true), 'empty')
  assert.throws(() => createFinanceDrainBudget({ maxClaims: 26, maxWallTimeMs: 45_000, claimReserveMs: 25_000 }))
  assert.throws(() => createFinanceDrainBudget({ maxClaims: 1, maxWallTimeMs: 60_000, claimReserveMs: 25_000 }))
})
