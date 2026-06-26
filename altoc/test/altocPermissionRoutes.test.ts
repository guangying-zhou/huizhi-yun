import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAltocApiPermission } from '../server/utils/altocPermissionRoutes.ts'

describe('resolveAltocApiPermission sensitive action mapping', () => {
  test('quotation approval requires quotation/approve', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/quotes/42/approve', 'POST', 'approve'),
      { resource: 'quotation', action: 'approve' }
    )
  })

  test('contract status approve or reject requires contract/approve', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/status', 'POST', 'approve'),
      { resource: 'contract', action: 'approve' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/status', 'POST', 'reject'),
      { resource: 'contract', action: 'approve' }
    )
  })

  test('contract status submit still requires contract/edit', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/status', 'POST', 'submit'),
      { resource: 'contract', action: 'edit' }
    )
  })

  test('payment confirmation requires receivable/confirm', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/payments/7/confirm', 'POST'),
      { resource: 'receivable', action: 'confirm' }
    )
  })

  test('billable sync requires receivable/mark-billable', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/receivable-plans/RP-1/mark-billable', 'POST'),
      { resource: 'receivable', action: 'mark-billable' }
    )
  })

  test('customer delivery asset status sync requires contract service scope', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/customer-delivery-assets/CDA-1/status:sync', 'POST'),
      { resource: 'contract', action: 'delivery-asset-status:sync' }
    )
  })

  test('service ticket close requires service_ticket/close', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service-tickets/ST-1', 'PATCH', 'closed'),
      { resource: 'service_ticket', action: 'close' }
    )
  })

  test('ordinary service ticket update remains service_ticket/edit', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service-tickets/ST-1', 'PATCH', 'processing'),
      { resource: 'service_ticket', action: 'edit' }
    )
  })

  test('document links map entity type to the owning resource', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/documents/99', 'DELETE', '', 'tender'),
      { resource: 'quotation', action: 'edit' }
    )
  })

  test('read-only shared config lists do not require settings permission', () => {
    assert.equal(resolveAltocApiPermission('/config/industries', 'GET'), null)
    assert.equal(resolveAltocApiPermission('/config/contract-business-templates', 'GET'), null)
  })

  test('contract lines use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/lines', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/lines/7', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('P0B contract lifecycle commands use contract permissions', () => {
    for (const command of ['submit', 'withdraw', 'mark-signed', 'suspend', 'terminate']) {
      assert.deepEqual(
        resolveAltocApiPermission(`/contracts/42/${command}`, 'POST'),
        { resource: 'contract', action: 'edit' }
      )
    }
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/fulfillment/close', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
  })

  test('P0B obligation commands use contract permissions', () => {
    for (const command of ['start', 'submit', 'accept', 'reject']) {
      assert.deepEqual(
        resolveAltocApiPermission(`/contract-obligations/7/${command}`, 'POST'),
        { resource: 'contract', action: 'edit' }
      )
    }
  })

  test('P0B obligation and billing subresources use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/obligations', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/billing-schedules', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('P1A activation and project link routes use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/activation-plan', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/activation/execute', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/activation/jobs/7/retry', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/project-links', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/delivery-asset-plans', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/contracts/42/service-agreements', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('service agreement project relation APIs use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/project-relations', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/project-relations', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/default-project', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/projects/PRJ-1/contract-lines', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })

  test('service agreement coverage APIs use contract permissions', () => {
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/coverages', 'GET'),
      { resource: 'contract', action: 'view' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/coverages', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreements/SA-1/coverages/SAC-1:resolve', 'POST'),
      { resource: 'contract', action: 'edit' }
    )
    assert.deepEqual(
      resolveAltocApiPermission('/service/service-agreement-coverages/by-environment/ENV-1', 'GET'),
      { resource: 'contract', action: 'view' }
    )
  })
})
