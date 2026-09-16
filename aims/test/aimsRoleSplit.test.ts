import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

type ManifestRole = {
  code: string
  suggestedPermissions?: string[]
}

const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')) as {
  recommendedRoles: ManifestRole[]
}

function role(code: string) {
  const found = manifest.recommendedRoles.find(item => item.code === code)
  assert.ok(found, `missing recommended role ${code}`)
  return found
}

function permissions(code: string) {
  return role(code).suggestedPermissions || []
}

function normalizeAimsPermission(permission: string) {
  const match = permission.match(/^aims:([^:]+):([^:]+)$/)
  assert.ok(match, `invalid Aims permission ${permission}`)
  return `${match[1]}:${match[2]}`
}

function seedPermissionsByRole(sql: string) {
  const start = sql.indexOf('INSERT INTO `tmp_aims_system_role_permission_seed`')
  const end = sql.indexOf('SET @aims_manifest_id', start)
  assert.notEqual(start, -1, 'missing Aims role permission seed block')
  assert.notEqual(end, -1, 'missing Aims role permission seed block terminator')

  const block = sql.slice(start, end)
  const result = new Map<string, string[]>()
  for (const match of block.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)) {
    const [, roleCode, resourceCode, action] = match
    const items = result.get(roleCode) || []
    items.push(`${resourceCode}:${action}`)
    result.set(roleCode, items)
  }
  return result
}

describe('Aims recommended role split', () => {
  test('member, PM, PMO, approval and admin roles remain separated', () => {
    assert.deepEqual(permissions('aims:member'), permissions('aims:dev'))

    assert.equal(permissions('aims:pm').includes('aims:projects:create'), true)
    assert.equal(permissions('aims:pm').includes('aims:projects:edit'), true)
    assert.equal(permissions('aims:pm').includes('aims:projects:close'), true)
    assert.equal(permissions('aims:pm').includes('aims:projects:admin'), false)
    assert.equal(permissions('aims:pm').includes('aims:work_items:confirm'), true)
    assert.equal(permissions('aims:pm').includes('aims:project_templates:admin'), false)
    assert.equal(permissions('aims:pm').includes('aims:admin:admin'), false)

    assert.equal(permissions('aims:pmo').includes('aims:portfolios:admin'), true)
    assert.equal(permissions('aims:pmo').includes('aims:projects:create'), true)
    assert.equal(permissions('aims:pmo').includes('aims:projects:edit'), true)
    assert.equal(permissions('aims:pmo').includes('aims:projects:close'), true)
    assert.equal(permissions('aims:pmo').includes('aims:projects:admin'), false)
    assert.equal(permissions('aims:pmo').includes('aims:timesheet:admin'), false)
    assert.equal(permissions('aims:pmo').includes('aims:reports:admin'), false)
    assert.equal(permissions('aims:pmo').includes('aims:reports:export'), true)
    assert.equal(permissions('aims:pmo').includes('aims:project_templates:admin'), false)
    assert.equal(permissions('aims:pmo').includes('aims:admin:admin'), false)
    assert.equal(permissions('aims:pmo').includes('aims:projects:approve'), false)

    assert.equal(permissions('aims:project_approver').includes('aims:projects:approve'), true)
    assert.equal(permissions('aims:project_approver').some(permission => permission.endsWith(':admin')), false)

    assert.equal(permissions('aims:project_director').includes('aims:projects:admin'), true)
    assert.equal(permissions('aims:project_director').includes('aims:project_templates:admin'), true)
    assert.equal(permissions('aims:project_director').includes('aims:admin:admin'), false)

    assert.equal(permissions('aims:admin').includes('aims:project_templates:admin'), true)
    assert.equal(permissions('aims:admin').includes('aims:admin:admin'), true)
    assert.equal(permissions('aims:admin').includes('aims:projects:create'), true)
    assert.equal(permissions('aims:admin').includes('aims:projects:approve'), false)
    assert.equal(permissions('aims:admin').includes('aims:work_items:confirm'), false)
    assert.equal(permissions('aims:admin').includes('aims:timesheet:approve'), false)
    assert.equal(permissions('aims:admin').includes('aims:reports:export'), false)
  })

  test('platform seed maps project director away from aims admin', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /\('project_director', 'aims:pmo', 10\)/)
    assert.match(seed, /\('project_director', 'aims:project_approver', 20\)/)
    assert.doesNotMatch(seed, /\('project_director', 'aims:admin',/)

    assert.match(seed, /\('project_member', 'aims:member', 10\)/)
    assert.doesNotMatch(seed, /\('project_member', 'aims:dev',/)
    assert.match(seed, /\('system_admin', 'aims:admin', 40\)/)
  })

  test('Aims SQL app-role seed matches current manifest role split', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.7-aims-system-roles.sql', import.meta.url),
      'utf8'
    )
    const seeded = seedPermissionsByRole(seed)

    for (const manifestRole of manifest.recommendedRoles) {
      const expected = (manifestRole.suggestedPermissions || [])
        .map(normalizeAimsPermission)
        .sort()
      const actual = (seeded.get(manifestRole.code) || []).sort()

      assert.deepEqual(actual, expected, `seed permissions must match ${manifestRole.code}`)
    }

    assert.equal(seeded.has('aims.project_manager'), false)
    assert.equal(seeded.has('aims.portfolio_manager'), false)
    assert.equal(seeded.has('aims.admin'), false)
  })

  test('project director admin-area grant repair is precise and invalidates affected policies', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.20-aims-project-director-admin-areas.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /'aims:project_director',\s*'projects',\s*'admin'/)
    assert.match(seed, /'aims:project_director',\s*'project_templates',\s*'admin'/)
    assert.doesNotMatch(seed, /'aims:project_director',\s*'admin',\s*'admin'/)
    assert.ok(
      seed.indexOf('INSERT INTO `platform_app_roles`') < seed.indexOf('SELECT \'project_director_role_exists\''),
      'the repair must create or reactivate aims:project_director before checking it'
    )
    assert.ok(
      seed.indexOf('SELECT \'all_manifest_actions_exist\'') < seed.indexOf('INSERT INTO `platform_app_roles`'),
      'the repair must validate manifest actions before persistent role writes'
    )
    assert.match(seed, /ON DUPLICATE KEY UPDATE[\s\S]*?`status` = 'active'/)
    assert.match(seed, /INSERT INTO `platform_system_roles`[\s\S]*?'project_director'/)
    assert.match(
      seed,
      /INSERT INTO `platform_system_app_role_maps`[\s\S]*?'project_director'[\s\S]*?'aims:project_director'/
    )
    assert.match(
      seed,
      /INSERT INTO `tenant_role_app_role_maps`[\s\S]*?'aims:project_director'[\s\S]*?`app_code` IS NULL[\s\S]*?`source` = 'system'[\s\S]*?`role_code` = 'project_director'/
    )
    assert.ok(
      seed.indexOf('INSERT INTO `tenant_role_app_role_maps`') < seed.indexOf('UPDATE `tenant_roles` tenant_role'),
      'tenant role mappings must exist before their policy revisions are invalidated'
    )
    assert.match(seed, /UPDATE `platform_app_roles`/)
    assert.match(seed, /UPDATE `platform_system_roles`/)
    assert.match(seed, /UPDATE `tenant_roles`/)
  })

  test('project creation uses precise projects/create instead of projects/admin', () => {
    const createApi = readFileSync(
      new URL('../server/api/v1/projects/index.post.ts', import.meta.url),
      'utf8'
    )
    const tenantRuntimeMiddleware = readFileSync(
      new URL('../server/middleware/tenant-runtime.ts', import.meta.url),
      'utf8'
    )
    const adminProjects = readFileSync(
      new URL('../app/pages/admin/projects.vue', import.meta.url),
      'utf8'
    )
    const projectsNew = readFileSync(
      new URL('../app/pages/projects/new.vue', import.meta.url),
      'utf8'
    )
    const createModal = readFileSync(
      new URL('../app/components/project/ProjectCreateModal.vue', import.meta.url),
      'utf8'
    )

    assert.match(createApi, /tenant-runtime is required to create projects/)
    assert.doesNotMatch(createApi, /server\/utils\/db/)
    assert.doesNotMatch(createApi, /requirePermission\(event, 'projects', 'admin'.+创建项目/)
    assert.match(tenantRuntimeMiddleware, /requirePermission\(event, 'projects', 'create'/)
    assert.doesNotMatch(tenantRuntimeMiddleware, /requirePermission\(event, 'projects', 'admin'.+创建项目/)
    assert.match(adminProjects, /hasPermission\('projects', 'create'\)/)
    assert.match(projectsNew, /hasPermission\('projects', 'create'\)/)
    assert.match(createModal, /hasPermission\('projects', 'create'\)/)
  })

  test('portfolio creation reports runtime validation errors without an unhandled rejection', () => {
    const createModal = readFileSync(
      new URL('../app/components/portfolio/PortfolioCreateModal.vue', import.meta.url),
      'utf8'
    )

    assert.match(createModal, /catch \(error: unknown\)/)
    assert.match(createModal, /创建项目集失败/)
    assert.match(createModal, /candidate\.data\?\.message/)
  })

  test('project and portfolio creation entries live in system project management', () => {
    const projectsOverview = readFileSync(
      new URL('../app/pages/projects/index.vue', import.meta.url),
      'utf8'
    )
    const adminProjects = readFileSync(
      new URL('../app/pages/admin/projects.vue', import.meta.url),
      'utf8'
    )
    const portfolioCreateModal = readFileSync(
      new URL('../app/components/portfolio/PortfolioCreateModal.vue', import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(projectsOverview, /新建项目集|新建项目|创建第一个项目/)
    assert.match(adminProjects, /label="新建项目集"/)
    assert.match(adminProjects, /label="新建项目"/)
    assert.match(adminProjects, /<PortfolioCreateModal/)
    assert.match(adminProjects, /<ProjectCreateModal/)
    assert.match(portfolioCreateModal, /hasPermission\('admin', 'admin'\)/)
  })

  test('Aims system management is not granted by inherited operator admin roles', () => {
    const authRoute = readFileSync(
      new URL('../server/api/auth/permissions.get.ts', import.meta.url),
      'utf8'
    )
    const permissionHelper = readFileSync(
      new URL('../server/utils/checkPermission.ts', import.meta.url),
      'utf8'
    )
    const adminAccess = readFileSync(
      new URL('../server/utils/aimsAdminAccess.ts', import.meta.url),
      'utf8'
    )
    const layout = readFileSync(
      new URL('../app/layouts/default.vue', import.meta.url),
      'utf8'
    )
    const routeGuard = readFileSync(
      new URL('../app/middleware/permission.global.ts', import.meta.url),
      'utf8'
    )
    const adminIndex = readFileSync(
      new URL('../app/pages/admin/index.vue', import.meta.url),
      'utf8'
    )
    const weeklyReports = readFileSync(
      new URL('../app/pages/weekly-reports.vue', import.meta.url),
      'utf8'
    )
    const projectsIndex = readFileSync(
      new URL('../app/pages/projects/index.vue', import.meta.url),
      'utf8'
    )
    const runtimeMiddleware = readFileSync(
      new URL('../server/middleware/tenant-runtime.ts', import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(`${authRoute}\n${permissionHelper}`, /globalAdminExpansion/)
    assert.match(adminAccess, /requirePermission\(event, 'admin', 'admin'/)
    assert.doesNotMatch(adminAccess, /checkRole|requireRole|system_admin|platform:admin|super_admin|console:admin/)

    assert.match(layout, /await loadAuthorization\(\{ force: true \}\)/)
    assert.match(layout, /routeRuleRequirements\(rule\)\.some\(item => hasPermission\(item\.resource, item\.action\)\)/)
    assert.match(routeGuard, /await loadPermissions\(\{ force: isAimsAdminRoute \}\)/)
    assert.match(routeGuard, /const allowed = \(\) => requirements\.some\(item => hasPermission\(item\.resource, item\.action\)\)/)
    assert.match(adminIndex, /v-if="canManageProjects"/)
    assert.match(adminIndex, /v-if="canManageProducts"/)
    assert.match(adminIndex, /v-if="canManageTemplates"/)

    for (const content of [layout, routeGuard, weeklyReports, projectsIndex, runtimeMiddleware]) {
      assert.doesNotMatch(content, /hasRole\('aims:admin'\)/)
      assert.doesNotMatch(content, /hasRole\('console:admin'\)/)
      assert.doesNotMatch(content, /hasRole\('console:console-dev-admin'\)/)
      assert.doesNotMatch(content, /hasRole\('system_admin'\)/)
      assert.doesNotMatch(content, /hasRole\('platform:admin'\)/)
      assert.doesNotMatch(content, /hasRole\('super_admin'\)/)
      assert.doesNotMatch(content, /checkRole\(.*'(?:aims:admin|console:admin|console:console-dev-admin)'/)
    }
  })
})
