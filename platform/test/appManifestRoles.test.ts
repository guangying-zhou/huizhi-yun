import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { parseManifestPermissionString } from '../server/utils/appManifestPermission.ts'

type ManifestAction = string | {
  action?: string
  code?: string
  actionCode?: string
}

type ManifestResource = {
  code?: string
  actions?: ManifestAction[]
}

type ManifestRole = {
  code?: string
  suggestedPermissions?: string[]
}

function workspaceRoot(path = '') {
  return new URL(`../../${path}`, import.meta.url)
}

function discoverWorkspaceManifestAppCodes() {
  return readdirSync(workspaceRoot(), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(appCode => appCode !== 'account')
    .filter(appCode => existsSync(workspaceRoot(`${appCode}/app.manifest.json`)))
    .sort()
}

function actionCode(action: ManifestAction) {
  const value = typeof action === 'string'
    ? action
    : (action.action || action.code || action.actionCode || '')
  return value.trim()
}

function manifestResourceActions(resources: ManifestResource[] = []) {
  const actionsByResource = new Map<string, Set<string>>()
  for (const resource of resources) {
    if (!resource.code) continue
    actionsByResource.set(
      resource.code,
      new Set((resource.actions || []).map(actionCode).filter(Boolean))
    )
  }
  return actionsByResource
}

describe('parseManifestPermissionString', () => {
  test('parses app:resource:action permission strings', () => {
    assert.deepEqual(
      parseManifestPermissionString('altoc:dashboard:view', 'altoc', 'altoc:viewer', 0),
      { appCode: 'altoc', resourceCode: 'dashboard', action: 'view' }
    )
  })

  test('keeps colon-delimited sensitive action suffixes as part of action', () => {
    assert.deepEqual(
      parseManifestPermissionString('altoc:contract:finance-summary:sync', 'altoc', 'altoc:admin', 17),
      { appCode: 'altoc', resourceCode: 'contract', action: 'finance-summary:sync' }
    )
    assert.deepEqual(
      parseManifestPermissionString('altoc:service_ticket:delivery-result:sync', 'altoc', 'altoc:admin', 25),
      { appCode: 'altoc', resourceCode: 'service_ticket', action: 'delivery-result:sync' }
    )
  })

  test('rejects malformed permission strings', () => {
    assert.throws(() => parseManifestPermissionString('altoc:contract', 'altoc', 'altoc:admin', 0), /must use app:resource:action/)
    assert.throws(() => parseManifestPermissionString('altoc:contract:', 'altoc', 'altoc:admin', 0), /must use app:resource:action/)
    assert.throws(() => parseManifestPermissionString('altoc:contract::sync', 'altoc', 'altoc:admin', 0), /must use app:resource:action/)
  })

  test('rejects permissions for another app', () => {
    assert.throws(
      () => parseManifestPermissionString('aims:projects:view', 'altoc', 'altoc:admin', 0),
      /appCode mismatch: expected altoc, got aims/
    )
  })

  test('workspace manifest recommended permissions reference declared resource actions', () => {
    const missingReferences = discoverWorkspaceManifestAppCodes().flatMap((appCode) => {
      const manifest = JSON.parse(readFileSync(workspaceRoot(`${appCode}/app.manifest.json`), 'utf8')) as {
        resources?: ManifestResource[]
        recommendedRoles?: ManifestRole[]
      }
      const actionsByResource = manifestResourceActions(manifest.resources)

      return (manifest.recommendedRoles || []).flatMap((role) => {
        const roleCode = role.code || '<missing-role-code>'
        return (role.suggestedPermissions || []).flatMap((permission, index) => {
          const parsed = parseManifestPermissionString(permission, appCode, roleCode, index)
          const actions = actionsByResource.get(parsed.resourceCode)
          const label = `${appCode}|${roleCode}|${permission}`

          if (!actions) return [`${label}|missing resource`]
          if (!actions.has(parsed.action)) return [`${label}|missing action`]
          return []
        })
      })
    }).sort()

    assert.deepEqual(missingReferences, [])
  })
})
