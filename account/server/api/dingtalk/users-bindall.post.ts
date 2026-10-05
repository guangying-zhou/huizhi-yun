/**
 * 一键关联钉钉用户到本地
 * POST /api/dingtalk/users-bindall
 *
 * 按邮箱匹配本地 system_users，更新 real_name、dingtalk_id、mobile、dept_code
 */
import { queryRows, execute } from '~~/server/utils/db'
import { buildCompanyEmail, resolveSyncedEmail } from '~~/server/utils/company-email'
import type { RowDataPacket } from 'mysql2/promise'

interface DingUserPayload {
  userid: string
  name: string
  email: string
  mobile?: string
  dept_names?: string
  active?: boolean
}

interface LocalUserRow extends RowDataPacket {
  id: number
  uid: string
  email: string | null
  real_name: string | null
  dingtalk_id: string | null
  mobile: string | null
  dept_code: string | null
  user_type: number
  status: number
}

interface DeptRow extends RowDataPacket {
  name: string
  dept_code: string
}

function normalizeValue(value: string | null | undefined) {
  return String(value || '').trim()
}

function normalizeEmail(value: string | null | undefined) {
  return normalizeValue(value).toLowerCase()
}

function getUserEmails(companyDomain: string, user: Pick<LocalUserRow, 'uid' | 'email'>) {
  const emails = new Set<string>()
  const actualEmail = normalizeEmail(user.email)
  if (actualEmail) emails.add(actualEmail)

  const companyEmail = buildCompanyEmail(companyDomain, user.uid, user.email)
  if (companyEmail) emails.add(normalizeEmail(companyEmail))

  return Array.from(emails)
}

function getDingEmails(companyDomain: string, dingUser: Pick<DingUserPayload, 'email'>) {
  const emails = new Set<string>()
  const sourceEmail = normalizeEmail(dingUser.email)
  if (sourceEmail) emails.add(sourceEmail)

  const companyEmail = buildCompanyEmail(companyDomain, dingUser.email)
  if (companyEmail) emails.add(normalizeEmail(companyEmail))

  return Array.from(emails)
}

function registerLocalUser(
  companyDomain: string,
  user: LocalUserRow,
  localByDingtalkId: Map<string, LocalUserRow>,
  localByEmail: Map<string, LocalUserRow>
) {
  const normalizedDingtalkId = normalizeValue(user.dingtalk_id)
  if (normalizedDingtalkId) {
    localByDingtalkId.set(normalizedDingtalkId, user)
  }

  for (const email of getUserEmails(companyDomain, user)) {
    localByEmail.set(email, user)
  }
}

function findLocalUser(
  dingUser: DingUserPayload,
  companyDomain: string,
  localByDingtalkId: Map<string, LocalUserRow>,
  localByEmail: Map<string, LocalUserRow>
) {
  const normalizedUserId = normalizeValue(dingUser.userid)
  if (normalizedUserId && localByDingtalkId.has(normalizedUserId)) {
    return localByDingtalkId.get(normalizedUserId)
  }

  for (const email of getDingEmails(companyDomain, dingUser)) {
    if (localByEmail.has(email)) {
      return localByEmail.get(email)
    }
  }

  return undefined
}

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  const config = useRuntimeConfig()
  const companyDomain = config.companyDomain

  const body = await readBody<{
    users: DingUserPayload[]
  }>(event)

  if (!body?.users || !Array.isArray(body.users)) {
    throw createError({ statusCode: 400, message: '请提供 users 数组' })
  }

  const localUsers = await queryRows<LocalUserRow[]>(
    'SELECT id, uid, email, real_name, dingtalk_id, mobile, dept_code, user_type, status FROM system_users WHERE user_type = 1'
  )
  const syncableLocalUsers = localUsers.filter(user => user.status !== -1)

  const localByDingtalkId = new Map<string, LocalUserRow>()
  const localByEmail = new Map<string, LocalUserRow>()
  const syncableLocalByDingtalkId = new Map<string, LocalUserRow>()
  const syncableLocalByEmail = new Map<string, LocalUserRow>()

  for (const user of localUsers) {
    registerLocalUser(companyDomain, user, localByDingtalkId, localByEmail)

    if (user.status !== -1) {
      registerLocalUser(companyDomain, user, syncableLocalByDingtalkId, syncableLocalByEmail)
    }
  }

  const localDepts = await queryRows<DeptRow[]>('SELECT name, dept_code FROM departments WHERE status = 1')
  const deptByName = new Map(localDepts.map(dept => [dept.name, dept.dept_code]))

  let linked = 0
  let created = 0
  let notFound = 0
  let alreadyLinked = 0
  let deptUpdated = 0
  const details: Array<{ userid: string, name: string, email: string, status: string, localUid?: string }> = []
  const missingInDatabase = new Map<string, { userid: string, name: string, email: string }>()
  const missingInDingtalk = new Map<string, { id: number, uid: string, realName: string, email: string, status: number, dingtalkId: string | null }>()
  const deletedInDatabase = new Map<string, { userid: string, name: string, email: string, localUid?: string }>()
  const inactiveInDingtalk = new Map<string, { userid: string, name: string, email: string, localUid?: string, localStatus?: number }>()
  const dingUserIds = new Set<string>()
  const dingUserEmails = new Set<string>()

  for (const dingUser of body.users) {
    const normalizedUserId = normalizeValue(dingUser.userid)
    if (normalizedUserId) dingUserIds.add(normalizedUserId)

    const dingEmails = getDingEmails(companyDomain, dingUser)
    for (const email of dingEmails) dingUserEmails.add(email)

    const matchedLocalUser = findLocalUser(dingUser, companyDomain, localByDingtalkId, localByEmail)

    if (!matchedLocalUser && dingUser.active !== false) {
      missingInDatabase.set(dingUser.userid, {
        userid: dingUser.userid,
        name: dingUser.name,
        email: dingEmails[0] || ''
      })
    }

    if (matchedLocalUser?.status === -1 && dingUser.active !== false) {
      deletedInDatabase.set(dingUser.userid, {
        userid: dingUser.userid,
        name: dingUser.name,
        email: dingEmails[0] || '',
        localUid: matchedLocalUser.uid
      })
    }

    if (dingUser.active === false && matchedLocalUser && matchedLocalUser.status !== -1) {
      inactiveInDingtalk.set(dingUser.userid, {
        userid: dingUser.userid,
        name: dingUser.name,
        email: dingEmails[0] || '',
        localUid: matchedLocalUser.uid,
        localStatus: matchedLocalUser.status
      })
    }

    if (dingUser.active === false) {
      details.push({
        userid: dingUser.userid,
        name: dingUser.name,
        email: dingEmails[0] || '',
        status: 'inactive_skipped',
        localUid: matchedLocalUser?.uid
      })
      continue
    }

    const sourceEmail = normalizeEmail(dingUser.email)
    const incomingCompanyEmail = buildCompanyEmail(companyDomain, sourceEmail)

    if (!sourceEmail && !incomingCompanyEmail) {
      notFound++
      details.push({ userid: dingUser.userid, name: dingUser.name, email: '', status: 'no_email' })
      continue
    }

    const localUser = findLocalUser(dingUser, companyDomain, syncableLocalByDingtalkId, syncableLocalByEmail)

    if (!localUser) {
      if (matchedLocalUser?.status === -1) {
        notFound++
        details.push({
          userid: dingUser.userid,
          name: dingUser.name,
          email: sourceEmail || incomingCompanyEmail || '',
          status: 'deleted_conflict',
          localUid: matchedLocalUser.uid
        })
        continue
      }

      const newUid = (sourceEmail.split('@')[0] || incomingCompanyEmail?.split('@')[0] || '').toLowerCase()
      const syncedEmail = resolveSyncedEmail({
        currentEmail: null,
        sourceEmail,
        companyDomain,
        fallbackUid: newUid
      })

      if (!newUid) {
        notFound++
        details.push({ userid: dingUser.userid, name: dingUser.name, email: sourceEmail, status: 'error' })
        continue
      }

      let newDeptCode: string | null = null
      if (dingUser.dept_names) {
        const firstName = dingUser.dept_names.split(',')[0]?.trim()
        if (firstName && deptByName.has(firstName)) {
          newDeptCode = deptByName.get(firstName)!
        }
      }

      try {
        await execute(
          'INSERT INTO system_users (uid, email, real_name, dingtalk_id, mobile, status) VALUES (?, ?, ?, ?, ?, 1)',
          [newUid, syncedEmail, dingUser.name, dingUser.userid, dingUser.mobile || null]
        )

        if (newDeptCode) {
          await execute('INSERT IGNORE INTO user_departments (uid, dept_code) VALUES (?, ?)', [newUid, newDeptCode])
        }

        created++
        details.push({
          userid: dingUser.userid,
          name: dingUser.name,
          email: syncedEmail || sourceEmail,
          status: 'created',
          localUid: newUid
        })
      } catch {
        notFound++
        details.push({ userid: dingUser.userid, name: dingUser.name, email: sourceEmail, status: 'error' })
      }
      continue
    }

    const syncedEmail = resolveSyncedEmail({
      currentEmail: localUser.email,
      sourceEmail,
      companyDomain,
      fallbackUid: localUser.uid
    })

    let localDeptCode: string | null = localUser.dept_code
    if (dingUser.dept_names) {
      const firstName = dingUser.dept_names.split(',')[0]?.trim()
      if (firstName && deptByName.has(firstName)) {
        localDeptCode = deptByName.get(firstName)!
      }
    }

    const currentEmail = normalizeEmail(localUser.email) || null
    const nextEmail = normalizeEmail(syncedEmail) || null
    const currentMobile = localUser.mobile || null
    const nextMobile = dingUser.mobile || localUser.mobile || null

    if (
      localUser.dingtalk_id === dingUser.userid
      && localUser.dept_code === localDeptCode
      && currentEmail === nextEmail
      && currentMobile === nextMobile
      && localUser.real_name === dingUser.name
    ) {
      alreadyLinked++
      details.push({
        userid: dingUser.userid,
        name: dingUser.name,
        email: syncedEmail || sourceEmail,
        status: 'already_linked',
        localUid: localUser.uid
      })
      continue
    }

    await execute(
      'UPDATE system_users SET real_name = ?, dingtalk_id = ?, mobile = ?, email = ? WHERE id = ?',
      [dingUser.name, dingUser.userid, nextMobile, syncedEmail, localUser.id]
    )

    if (localDeptCode !== localUser.dept_code) {
      deptUpdated++

      await execute(
        `DELETE ud FROM user_departments ud
         JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
         WHERE ud.uid = ?`,
        [localUser.uid]
      )

      if (localDeptCode) {
        await execute('INSERT IGNORE INTO user_departments (uid, dept_code) VALUES (?, ?)', [localUser.uid, localDeptCode])
      }
    }

    linked++
    details.push({
      userid: dingUser.userid,
      name: dingUser.name,
      email: syncedEmail || sourceEmail,
      status: 'linked',
      localUid: localUser.uid
    })
  }

  for (const localUser of syncableLocalUsers) {
    const normalizedDingtalkId = normalizeValue(localUser.dingtalk_id)
    const emailCandidates = getUserEmails(companyDomain, localUser)
    const matchedById = normalizedDingtalkId ? dingUserIds.has(normalizedDingtalkId) : false
    const matchedByEmail = emailCandidates.some(email => dingUserEmails.has(email))

    if (!matchedById && !matchedByEmail) {
      const key = normalizedDingtalkId || localUser.uid
      missingInDingtalk.set(key, {
        id: localUser.id,
        uid: localUser.uid,
        realName: localUser.real_name || localUser.uid,
        email: emailCandidates[0] || '',
        status: localUser.status,
        dingtalkId: localUser.dingtalk_id
      })
    }
  }

  return {
    code: 0,
    data: {
      total: body.users.length,
      linked,
      created,
      alreadyLinked,
      notFound,
      deptUpdated,
      details,
      discrepancies: {
        total: missingInDatabase.size + missingInDingtalk.size + deletedInDatabase.size + inactiveInDingtalk.size,
        missingInDatabase: Array.from(missingInDatabase.values()),
        missingInDingtalk: Array.from(missingInDingtalk.values()),
        deletedInDatabase: Array.from(deletedInDatabase.values()),
        inactiveInDingtalk: Array.from(inactiveInDingtalk.values())
      }
    }
  }
})
