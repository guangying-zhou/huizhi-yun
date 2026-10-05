import { useDatabase } from '../../utils/database'
import { resolveSyncedEmail } from '../../utils/company-email'
import { fetchLdapUsers } from '../../utils/ldap'
import type { RowDataPacket } from 'mysql2/promise'

interface ExistingCacheRow extends RowDataPacket {
  id: number
  email: string | null
}

interface ExistingSystemUserRow extends RowDataPacket {
  id: number
  email: string | null
  status: number
}

interface MissingLdapUserRow extends RowDataPacket {
  id: number
  uid: string
}

export default defineEventHandler(async () => {
  const pool = useDatabase()
  const config = useRuntimeConfig()
  const companyDomain = config.companyDomain

  // 从 runtimeConfig 获取 LDAP 配置
  const ldapConfig = {
    host: config.ldap.host,
    port: config.ldap.port,
    bindDN: config.ldap.bindDN,
    bindPassword: config.ldap.bindPassword,
    baseDN: config.ldap.baseDN,
    userBase: config.ldap.userBase,
    useTLS: config.ldap.useTLS
  }

  try {
    // 1. 从 LDAP 获取用户列表
    console.log('[LDAP Sync] Starting LDAP user sync...')
    const ldapUsers = await fetchLdapUsers(ldapConfig)
    console.log(`[LDAP Sync] Fetched ${ldapUsers.length} users from LDAP`)

    if (ldapUsers.length === 0) {
      return {
        success: true,
        message: 'LDAP 中没有用户数据',
        stats: { inserted: 0, updated: 0, errors: 0 }
      }
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    let inserted = 0
    let updated = 0
    let errors = 0
    let deleted = 0
    const ldapUids = Array.from(new Set(ldapUsers.map(user => user.uid).filter(Boolean)))

    for (const user of ldapUsers) {
      try {
        // 检查用户是否已存在
        const [existingRows] = await pool.execute<ExistingCacheRow[]>(
          'SELECT id, email FROM user_status_cache WHERE ldap_uid = ?',
          [user.uid]
        )

        const existingCache = existingRows[0]
        const syncedEmail = resolveSyncedEmail({
          currentEmail: existingCache?.email,
          sourceEmail: user.mail,
          companyDomain,
          fallbackUid: user.uid
        })

        if (existingRows.length > 0) {
          // 更新
          await pool.execute(
            `UPDATE user_status_cache
             SET ldap_dn = ?, ldap_cn = ?, email = ?, ldap_sn = ?, status = 1, synced_at = ?, updated_at = ?
             WHERE ldap_uid = ?`,
            [user.dn, user.cn, syncedEmail, user.sn, now, now, user.uid]
          )
          updated++
        } else {
          // 插入 user_status_cache
          await pool.execute(
            `INSERT INTO user_status_cache
             (uid, ldap_dn, ldap_cn, email, ldap_sn, status, synced_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
            [user.uid, user.dn, user.cn, syncedEmail, user.sn, now, now, now]
          )
          inserted++
        }

        // 同步 system_users 表 - 只有新用户才设置 real_name，已存在的不覆盖
        const [existingProfile] = await pool.execute<ExistingSystemUserRow[]>(
          'SELECT id, email, status FROM system_users WHERE uid = ?',
          [user.uid]
        )

        const existingSystemUser = existingProfile[0]
        const profileEmail = resolveSyncedEmail({
          currentEmail: existingSystemUser?.email,
          sourceEmail: user.mail,
          companyDomain,
          fallbackUid: user.uid
        })

        if (existingProfile.length === 0) {
          // 新用户：使用 LDAP 中的 sn 或 cn 作为初始 real_name
          const realName = user.sn || user.cn
          await pool.execute(
            `INSERT INTO system_users (uid, real_name, nickname, email, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [user.uid, realName, null, profileEmail, now, now]
          )
        } else {
          // 已存在的用户：不更新 real_name 和 nickname，保留用户自己修改的值
          await pool.execute(
            `UPDATE system_users
             SET email = ?, status = CASE WHEN status = -1 THEN 1 ELSE status END, updated_at = ?
             WHERE uid = ?`,
            [profileEmail, now, user.uid]
          )
        }
      } catch (err) {
        console.error(`[LDAP Sync] Error syncing user ${user.uid}:`, err)
        errors++
      }
    }

    if (ldapUids.length > 0) {
      const placeholders = ldapUids.map(() => '?').join(',')
      const [missingUsers] = await pool.query<MissingLdapUserRow[]>(
        `SELECT su.id, su.uid
         FROM system_users su
         LEFT JOIN user_status_cache usc ON usc.ldap_uid = su.uid
         WHERE su.status != -1
           AND su.user_type = 1
           AND COALESCE(su.dingtalk_id, '') = ''
           AND COALESCE(su.wecom_id, '') = ''
           AND COALESCE(su.uid, '') != ''
           AND su.uid NOT IN (${placeholders})`,
        ldapUids
      )

      if (missingUsers.length > 0) {
        const missingUids = missingUsers.map(user => user.uid)
        const missingPlaceholders = missingUids.map(() => '?').join(',')

        await pool.query(
          `UPDATE system_users
           SET status = -1, updated_at = ?
           WHERE uid IN (${missingPlaceholders})`,
          [now, ...missingUids]
        )

        await pool.query(
          `UPDATE user_status_cache
           SET status = 0, updated_at = ?
           WHERE ldap_uid IN (${missingPlaceholders})`,
          [now, ...missingUids]
        )

        await pool.query(
          `DELETE FROM user_departments
           WHERE uid IN (${missingPlaceholders})`,
          missingUids
        )

        deleted = missingUsers.length
      }
    }

    console.log(`[LDAP Sync] Completed: inserted=${inserted}, updated=${updated}, deleted=${deleted}, errors=${errors}`)

    return {
      success: true,
      message: `同步完成: 新增 ${inserted} 个用户, 更新 ${updated} 个用户, 删除标记 ${deleted} 个用户`,
      stats: { inserted, updated, deleted, errors, total: ldapUsers.length }
    }
  } catch (error) {
    console.error('[LDAP Sync] Error:', error)
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'LDAP 同步失败'
    })
  }
})
