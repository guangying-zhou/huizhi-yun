#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import mysql from 'mysql2/promise'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const value = argv[index + 1]
    args[key] = value && !value.startsWith('--') ? value : true
    if (args[key] !== true) index += 1
  }
  return args
}

function parseEnv(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
        .replaceAll('\\n', '\n')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\')
    }
    env[line.slice(0, separator).trim()] = value
  }
  return env
}

function text(value) {
  return String(value || '').trim()
}

function nullable(value) {
  return text(value) || null
}

function parsePermission(value, appCode) {
  const parts = text(value).split(':')
  if (parts.length < 3 || parts[0] !== appCode) {
    throw new Error(`invalid ${appCode} manifest permission: ${value}`)
  }
  return {
    appCode: parts[0],
    resourceCode: parts.slice(1, -1).join(':'),
    action: parts.at(-1)
  }
}

function policyHash(permissions, scopes) {
  const normalizedPermissions = permissions.map(row => ({
    appCode: row.app_code,
    resourceCode: row.resource_code,
    action: row.action,
    manifestActionId: Number(row.manifest_action_id || 0) || null
  })).sort((left, right) => (
    left.appCode.localeCompare(right.appCode)
    || left.resourceCode.localeCompare(right.resourceCode)
    || left.action.localeCompare(right.action)
    || Number(left.manifestActionId || 0) - Number(right.manifestActionId || 0)
  ))
  const normalizedScopes = scopes.map(row => ({
    appCode: row.app_code,
    resourceCode: row.resource_code,
    action: row.action,
    manifestActionId: Number(row.manifest_action_id || 0) || null,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    status: row.status
  })).sort((left, right) => (
    left.appCode.localeCompare(right.appCode)
    || left.resourceCode.localeCompare(right.resourceCode)
    || left.action.localeCompare(right.action)
    || left.scopeType.localeCompare(right.scopeType)
    || left.scopeValue.localeCompare(right.scopeValue)
    || left.status.localeCompare(right.status)
    || Number(left.manifestActionId || 0) - Number(right.manifestActionId || 0)
  ))
  const serialized = JSON.stringify({
    version: 1,
    permissions: normalizedPermissions,
    scopes: normalizedScopes
  })
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows
}

async function queryOne(connection, sql, params = []) {
  return (await queryRows(connection, sql, params))[0] || null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const envFile = resolve(text(args['env-file']))
  const manifestFile = resolve(text(args.manifest))
  const backupFile = resolve(text(args.backup))
  const tenantCode = text(args.tenant)
  const deploymentCode = text(args.deployment)
  if (!envFile || !manifestFile || !backupFile || !tenantCode || !deploymentCode || args.execute !== true) {
    throw new Error('usage: --env-file <path> --manifest <path> --backup <path> --tenant <code> --deployment <code> --execute')
  }

  const env = { ...process.env, ...parseEnv(await readFile(envFile, 'utf8')) }
  if (env.DB_NAME !== 'hzy_platform_dev') {
    throw new Error(`refusing non-development database: ${env.DB_NAME || '<empty>'}`)
  }
  if (tenantCode !== 'C000001') {
    throw new Error(`refusing unexpected test tenant: ${tenantCode}`)
  }

  const sourceManifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (sourceManifest?.appCode !== 'console') {
    throw new Error('manifest appCode must be console')
  }
  const manifest = { ...sourceManifest }
  delete manifest.version
  delete manifest.displayVersion
  const serializedManifest = JSON.stringify(manifest)
  const manifestHash = `sha256:${createHash('sha256').update(serializedManifest).digest('hex')}`
  const resources = Array.isArray(manifest.resources) ? manifest.resources : []
  const roles = Array.isArray(manifest.recommendedRoles) ? manifest.recommendedRoles : []

  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z'
  })

  try {
    const application = await queryOne(
      connection,
      'SELECT * FROM platform_applications WHERE app_code = ? LIMIT 1',
      ['console']
    )
    if (!application) throw new Error('console application is not registered')
    const deployment = await queryOne(
      connection,
      `SELECT id, tenant_code, app_code, deployment_code, environment, status
         FROM deployments
        WHERE tenant_code = ?
          AND deployment_code = ?
        LIMIT 1`,
      [tenantCode, deploymentCode]
    )
    if (!deployment) throw new Error(`test Console deployment not found: ${deploymentCode}`)
    if (
      deployment.app_code !== 'console'
      || deployment.environment !== 'test'
      || deployment.status !== 'active'
    ) {
      throw new Error(`refusing non-active test Console deployment: ${deploymentCode}`)
    }
    const existingRoleRows = await queryRows(
      connection,
      'SELECT * FROM platform_app_roles WHERE app_code = ? ORDER BY id',
      ['console']
    )
    const roleIds = existingRoleRows.map(row => Number(row.id)).filter(Boolean)
    const backup = {
      capturedAt: new Date().toISOString(),
      database: env.DB_NAME,
      tenantCode,
      deployment,
      application,
      latestManifest: application.latest_manifest_id
        ? await queryOne(connection, 'SELECT * FROM platform_app_manifests WHERE id = ?', [application.latest_manifest_id])
        : null,
      latestManifestResources: application.latest_manifest_id
        ? await queryRows(connection, 'SELECT * FROM platform_app_manifest_resources WHERE manifest_id = ? ORDER BY id', [application.latest_manifest_id])
        : [],
      latestManifestActions: application.latest_manifest_id
        ? await queryRows(connection, 'SELECT * FROM platform_app_manifest_resource_actions WHERE manifest_id = ? ORDER BY id', [application.latest_manifest_id])
        : [],
      appRoles: existingRoleRows,
      appRolePermissions: roleIds.length
        ? await queryRows(connection, `SELECT * FROM platform_app_role_permissions WHERE app_role_id IN (${roleIds.map(() => '?').join(',')}) ORDER BY id`, roleIds)
        : [],
      tenantPolicyRevision: await queryOne(
        connection,
        'SELECT * FROM tenant_policy_revisions WHERE tenant_code = ? LIMIT 1',
        [tenantCode]
      ),
      activeDeploymentPolicyBundles: await queryRows(
        connection,
        `SELECT pb.*
           FROM policy_bundles pb
           INNER JOIN policy_bundle_targets pbt ON pbt.bundle_id = pb.id
          WHERE pbt.deployment_id = ?
            AND pb.status = 'active'
          `,
        [deployment.id]
      )
    }
    await mkdir(dirname(backupFile), { recursive: true, mode: 0o700 })
    await writeFile(backupFile, `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 })
    await chmod(backupFile, 0o600)

    await connection.beginTransaction()
    try {
      await connection.query(
        'SELECT id FROM platform_applications WHERE app_code = ? LIMIT 1 FOR UPDATE',
        ['console']
      )
      let manifestId
      const existingManifest = await queryOne(
        connection,
        'SELECT id FROM platform_app_manifests WHERE app_code = ? AND manifest_hash = ? LIMIT 1',
        ['console', manifestHash]
      )
      if (existingManifest) {
        manifestId = Number(existingManifest.id)
      } else {
        const sequence = await queryOne(
          connection,
          'SELECT COALESCE(MAX(manifest_seq), 0) + 1 AS nextSeq FROM platform_app_manifests WHERE app_code = ? FOR UPDATE',
          ['console']
        )
        const [inserted] = await connection.execute(
          `INSERT INTO platform_app_manifests
            (app_code, manifest_seq, manifest_hash, manifest_json, status, created_at)
           VALUES ('console', ?, ?, ?, 'active', UTC_TIMESTAMP())`,
          [Number(sequence?.nextSeq || 1), manifestHash, serializedManifest]
        )
        manifestId = Number(inserted.insertId)
      }

      const actionIds = new Map()
      for (const [resourceIndex, rawResource] of resources.entries()) {
        const resourceCode = text(rawResource?.code || rawResource?.resourceCode)
        if (!resourceCode) continue
        const [insertedResource] = await connection.execute(
          `INSERT INTO platform_app_manifest_resources
            (manifest_id, app_code, resource_code, resource_name, description, sort_order, status, created_at)
           VALUES (?, 'console', ?, ?, ?, ?, 'active', UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), resource_name = VALUES(resource_name),
             description = VALUES(description), sort_order = VALUES(sort_order), status = 'active'`,
          [
            manifestId,
            resourceCode,
            text(rawResource?.name || rawResource?.resourceName) || resourceCode,
            nullable(rawResource?.description),
            Number(rawResource?.sortOrder || ((resourceIndex + 1) * 10))
          ]
        )
        const resourceId = Number(insertedResource.insertId)
        const actions = Array.isArray(rawResource?.actions) ? rawResource.actions : []
        for (const [actionIndex, rawAction] of actions.entries()) {
          const action = typeof rawAction === 'string' ? text(rawAction) : text(rawAction?.action || rawAction?.code)
          if (!action) continue
          await connection.execute(
            `INSERT INTO platform_app_manifest_resource_actions
              (manifest_resource_id, manifest_id, app_code, resource_code, action,
               action_name, description, sort_order, status, requires_grant, created_at)
             VALUES (?, ?, 'console', ?, ?, ?, ?, ?, 'active', ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE action_name = VALUES(action_name), description = VALUES(description),
               sort_order = VALUES(sort_order), status = 'active', requires_grant = VALUES(requires_grant)`,
            [
              resourceId,
              manifestId,
              resourceCode,
              action,
              typeof rawAction === 'object' ? nullable(rawAction?.name) : null,
              typeof rawAction === 'object' ? nullable(rawAction?.description) : null,
              Number((typeof rawAction === 'object' && rawAction?.sortOrder) || ((actionIndex + 1) * 10)),
              typeof rawAction === 'object' && rawAction?.requiresGrant === false ? 0 : 1
            ]
          )
          const actionRow = await queryOne(
            connection,
            `SELECT id FROM platform_app_manifest_resource_actions
              WHERE manifest_id = ? AND app_code = 'console' AND resource_code = ? AND action = ? LIMIT 1`,
            [manifestId, resourceCode, action]
          )
          actionIds.set(`${resourceCode}:${action}`, Number(actionRow.id))
        }
      }

      let permissionCount = 0
      for (const rawRole of roles) {
        const roleCode = text(rawRole?.code)
        if (!roleCode.startsWith('console:')) throw new Error(`invalid Console role: ${roleCode}`)
        let role = await queryOne(
          connection,
          'SELECT id, policy_hash AS policyHash FROM platform_app_roles WHERE role_code = ? LIMIT 1',
          [roleCode]
        )
        if (role) {
          await connection.execute(
            `UPDATE platform_app_roles
                SET role_name = ?, role_type = 'app', app_code = 'console', description = ?,
                    status = 'active', updated_at = UTC_TIMESTAMP()
              WHERE id = ?`,
            [text(rawRole?.name) || roleCode, nullable(rawRole?.description), role.id]
          )
        } else {
          const [insertedRole] = await connection.execute(
            `INSERT INTO platform_app_roles
              (role_code, role_name, role_type, app_code, description, is_required, status, created_at, updated_at)
             VALUES (?, ?, 'app', 'console', ?, 0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
            [roleCode, text(rawRole?.name) || roleCode, nullable(rawRole?.description)]
          )
          role = { id: Number(insertedRole.insertId), policyHash: null }
        }
        await connection.execute('DELETE FROM platform_app_role_permissions WHERE app_role_id = ?', [role.id])
        for (const rawPermission of rawRole?.suggestedPermissions || []) {
          const permission = parsePermission(rawPermission, 'console')
          const manifestActionId = actionIds.get(`${permission.resourceCode}:${permission.action}`)
          if (!manifestActionId) {
            throw new Error(`manifest action unavailable: ${rawPermission}`)
          }
          await connection.execute(
            `INSERT INTO platform_app_role_permissions
              (app_role_id, app_code, resource_code, action, manifest_action_id, created_at)
             VALUES (?, 'console', ?, ?, ?, UTC_TIMESTAMP())`,
            [role.id, permission.resourceCode, permission.action, manifestActionId]
          )
          permissionCount += 1
        }
        const permissions = await queryRows(
          connection,
          `SELECT app_code, resource_code, action, manifest_action_id
             FROM platform_app_role_permissions WHERE app_role_id = ?`,
          [role.id]
        )
        const scopes = await queryRows(
          connection,
          `SELECT app_code, resource_code, action, manifest_action_id, scope_type, scope_value, status
             FROM platform_app_role_scopes WHERE app_role_id = ?`,
          [role.id]
        )
        const nextHash = policyHash(permissions, scopes)
        const changed = role.policyHash !== nextHash
        await connection.execute(
          `UPDATE platform_app_roles
              SET policy_hash = ?, policy_revision = policy_revision + ?,
                  policy_updated_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE policy_updated_at END,
                  updated_at = UTC_TIMESTAMP()
            WHERE id = ?`,
          [nextHash, changed ? 1 : 0, changed ? 1 : 0, role.id]
        )
      }

      const registrationNo = `REG-CTR812-${Date.now()}-${randomBytes(3).toString('hex')}`
      const [registration] = await connection.execute(
        `INSERT INTO platform_app_manifest_registrations
          (registration_no, app_code, submitted_version, submitted_manifest_hash, submitted_manifest_json,
           source_type, source_endpoint, registration_status, review_status, result_manifest_id,
           review_comment, reviewed_at, created_at, updated_at)
         VALUES (?, 'console', 'ctr812-test', ?, ?, 'maintenance', 'local:console/app.manifest.json',
           'accepted', 'approved', ?, 'CTR-812 isolated acceptance manifest refresh',
           UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [registrationNo, manifestHash, serializedManifest, manifestId]
      )
      await connection.execute(
        `UPDATE platform_applications
            SET latest_manifest_id = ?, latest_registration_id = ?,
                last_manifest_registered_at = UTC_TIMESTAMP(),
                last_manifest_review_status = 'approved', updated_at = UTC_TIMESTAMP()
          WHERE app_code = 'console'`,
        [manifestId, registration.insertId]
      )
      await connection.execute(
        `INSERT INTO tenant_policy_revisions
          (tenant_code, policy_revision, policy_hash, policy_updated_at, created_at, updated_at)
         VALUES (?, 1, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE policy_revision = policy_revision + 1,
           policy_hash = NULL, policy_updated_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()`,
        [tenantCode]
      )
      const [supersededBundles] = await connection.execute(
        `UPDATE policy_bundles pb
          INNER JOIN policy_bundle_targets pbt ON pbt.bundle_id = pb.id
             SET pb.status = 'superseded'
           WHERE pbt.deployment_id = ?
             AND pb.tenant_code = ?
             AND pb.environment = 'test'
             AND pb.status = 'active'`,
        [deployment.id, tenantCode]
      )
      await connection.commit()

      const adminRole = await queryOne(
        connection,
        `SELECT ar.id,
                SUM(arp.resource_code = 'authorization_lifecycle' AND arp.action = 'admin') AS lifecycleAdmin,
                SUM(arp.resource_code = 'audit_logs' AND arp.action = 'view') AS auditView
           FROM platform_app_roles ar
           LEFT JOIN platform_app_role_permissions arp ON arp.app_role_id = ar.id
          WHERE ar.role_code = 'console:admin'
          GROUP BY ar.id`,
        []
      )
      if (Number(adminRole?.lifecycleAdmin) !== 1 || Number(adminRole?.auditView) !== 1) {
        throw new Error('Console admin role verification failed')
      }
      console.info(JSON.stringify({
        status: 'verified',
        database: env.DB_NAME,
        tenantCode,
        manifestId,
        manifestHash,
        resourceCount: resources.length,
        roleCount: roles.length,
        permissionCount,
        supersededBundleCount: Number(supersededBundles.affectedRows || 0),
        consoleAdminLifecycleAdmin: true,
        consoleAdminAuditView: true,
        backupMode: '0600'
      }))
    } catch (error) {
      await connection.rollback()
      throw error
    }
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(`[platform-dev-console-manifest] ${error.message}`)
  process.exitCode = 1
})
