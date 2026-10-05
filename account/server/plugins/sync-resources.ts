/**
 * Account 启动时同步自身资源定义到数据库
 *
 * Account 作为权限中心，直接操作自身数据库
 * 无需调用外部 API
 */
import { appCode, resources } from '~~/app/config/permissions'
import { queryRows, getConnection } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

export default defineNitroPlugin(() => {
  setTimeout(async () => {
    try {
      // 查找 account 应用
      const apps = await queryRows<(RowDataPacket & { id: number })[]>(
        'SELECT id FROM applications WHERE app_code = ?',
        [appCode]
      )

      if (apps.length === 0) {
        console.warn(`[SyncResources] Application '${appCode}' not found in database, skipping`)
        return
      }

      const appId = apps[0]!.id

      // 获取现有资源
      const existing = await queryRows<(RowDataPacket & {
        id: number
        resource_code: string
        resource_name: string
        description: string
        sort_order: number
        status: number
      })[]>(
        'SELECT id, resource_code, resource_name, description, sort_order, status FROM resources WHERE app_id = ?',
        [appId]
      )

      const existingMap = new Map(existing.map(r => [r.resource_code, r]))
      const incomingCodes = new Set(resources.map(r => r.code))

      const conn = await getConnection()
      await conn.beginTransaction()

      try {
        let inserted = 0
        let updated = 0
        let deprecated = 0

        for (const res of resources) {
          const ex = existingMap.get(res.code)
          if (!ex) {
            await conn.execute(
              'INSERT INTO resources (app_id, resource_code, resource_name, description, sort_order, status) VALUES (?, ?, ?, ?, ?, 1)',
              [appId, res.code, res.name, res.description || '', res.sortOrder ?? 0]
            )
            inserted++
          } else if (
            ex.resource_name !== res.name
            || ex.description !== (res.description || '')
            || ex.sort_order !== (res.sortOrder ?? 0)
            || ex.status !== 1
          ) {
            await conn.execute(
              'UPDATE resources SET resource_name = ?, description = ?, sort_order = ?, status = 1 WHERE id = ?',
              [res.name, res.description || '', res.sortOrder ?? 0, ex.id]
            )
            updated++
          }
        }

        // 标记不在清单中的资源为废弃
        for (const [code, ex] of existingMap) {
          if (!incomingCodes.has(code) && ex.status === 1) {
            await conn.execute('UPDATE resources SET status = 0 WHERE id = ?', [ex.id])
            deprecated++
          }
        }

        // 确保 super_admin 角色拥有所有有效资源的全部权限
        const superAdminRows = await queryRows<(RowDataPacket & { id: number })[]>(
          'SELECT id FROM roles WHERE role_code = ?',
          ['super_admin']
        )
        if (superAdminRows.length > 0) {
          const superAdminId = superAdminRows[0]!.id
          const allResources = await queryRows<(RowDataPacket & { id: number })[]>(
            'SELECT id FROM resources WHERE app_id = ? AND status = 1',
            [appId]
          )
          for (const res of allResources) {
            for (const action of ['view', 'edit', 'admin']) {
              await conn.execute(
                'INSERT IGNORE INTO role_permissions (role_id, resource_id, action) VALUES (?, ?, ?)',
                [superAdminId, res.id, action]
              )
            }
          }
        }

        await conn.commit()
        console.log(`[SyncResources] Account self-sync: ${inserted} new, ${updated} updated, ${deprecated} deprecated`)
      } catch (e) {
        await conn.rollback()
        throw e
      } finally {
        conn.release()
      }
    } catch (err: unknown) {
      const error = err as { message?: string }
      console.warn('[SyncResources] Failed to sync resources:', error.message || error)
    }
  }, 3000)
})
