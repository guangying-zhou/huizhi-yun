import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

interface ManifestRole {
  code: string
  suggestedPermissions: string[]
}

function manifestRoles() {
  const content = readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')
  const manifest = JSON.parse(content) as { recommendedRoles: ManifestRole[] }
  return manifest.recommendedRoles
}

function permissions(code: string) {
  const role = manifestRoles().find(item => item.code === code)
  expect(role, `${code} role must exist`).toBeTruthy()
  return role?.suggestedPermissions || []
}

function platformSeed() {
  return readFileSync(
    new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql', import.meta.url),
    'utf8'
  )
}

function mappedAppRoles(systemRoleCode: string) {
  const pattern = new RegExp(`\\('${systemRoleCode}', '([^']+)'`, 'g')
  return Array.from(platformSeed().matchAll(pattern), match => match[1])
}

function expectNoOperationalPermissions(roleCode: string) {
  const rolePermissions = permissions(roleCode)
  for (const permission of rolePermissions) {
    expect(permission.endsWith(':edit'), `${roleCode} should not include ${permission}`).toBe(false)
    expect(permission.endsWith(':admin'), `${roleCode} should not include ${permission}`).toBe(false)
    expect(permission.endsWith(':trigger'), `${roleCode} should not include ${permission}`).toBe(false)
  }
}

describe('Insights recommended role split', () => {
  it('declares focused Insights operation roles', () => {
    for (const role of [
      'insights:viewer',
      'insights:analyst',
      'insights:report_exporter',
      'insights:contributor_manager',
      'insights:ingestion_operator',
      'insights:monitoring_operator',
      'insights:monitoring_admin',
      'insights:repository_admin',
      'insights:settings_admin',
      'insights:admin'
    ]) {
      expect(permissions(role).length, `${role} should have suggested permissions`).toBeGreaterThan(0)
    }
  })

  it('keeps analyst read-only and separates report export', () => {
    expectNoOperationalPermissions('insights:analyst')
    expect(permissions('insights:analyst')).toContain('insights:monitoring:view')
    expect(permissions('insights:analyst')).not.toContain('insights:dashboard:export')

    expect(permissions('insights:report_exporter')).toContain('insights:dashboard:export')
    expect(permissions('insights:report_exporter')).not.toContain('insights:contributors:edit')
    expect(permissions('insights:report_exporter')).not.toContain('insights:repo_ingestion:trigger')
  })

  it('isolates contributor, ingestion, monitoring, repository and settings operations', () => {
    expect(permissions('insights:contributor_manager')).toContain('insights:contributors:edit')
    expect(permissions('insights:contributor_manager')).not.toContain('insights:repo_ingestion:trigger')

    expect(permissions('insights:ingestion_operator')).toContain('insights:repo_ingestion:trigger')
    expect(permissions('insights:ingestion_operator')).not.toContain('insights:repo_ingestion:admin')

    expect(permissions('insights:monitoring_operator')).toContain('insights:monitoring:edit')
    expect(permissions('insights:monitoring_operator')).not.toContain('insights:monitoring:admin')

    expect(permissions('insights:monitoring_admin')).toContain('insights:monitoring:admin')
    expect(permissions('insights:monitoring_admin')).not.toContain('insights:insights_settings:admin')

    expect(permissions('insights:repository_admin')).toContain('insights:repos:admin')
    expect(permissions('insights:repository_admin')).toContain('insights:repo_ingestion:admin')
    expect(permissions('insights:repository_admin')).not.toContain('insights:insights_settings:admin')

    expect(permissions('insights:settings_admin')).toContain('insights:insights_settings:admin')
    expect(permissions('insights:settings_admin')).not.toContain('insights:repos:admin')
  })

  it('admin explicitly carries sensitive ingestion trigger and export actions', () => {
    expect(permissions('insights:admin')).toContain('insights:repo_ingestion:trigger')
    expect(permissions('insights:admin')).toContain('insights:dashboard:export')
  })

  it('project director seed gets analysis and export but not operational maintenance', () => {
    const projectDirector = mappedAppRoles('project_director')

    expect(projectDirector).toContain('insights:analyst')
    expect(projectDirector).toContain('insights:report_exporter')
    for (const role of [
      'insights:contributor_manager',
      'insights:ingestion_operator',
      'insights:monitoring_admin',
      'insights:repository_admin',
      'insights:settings_admin',
      'insights:admin'
    ]) {
      expect(projectDirector, `project_director should not include ${role}`).not.toContain(role)
    }
  })
})
