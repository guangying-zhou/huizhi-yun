import { readBody } from 'h3'
import { ok } from '~~/server/utils/api'
import { createPlatformSession, touchAccountLogin } from '~~/server/utils/platformAuth'
import { activateEmailAccount, markLocalEmailIdentityLogin, normalizeRedirect } from '~~/server/utils/emailAuth'
import { queryRow } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

type ActivateBody = {
  token?: string
  redirect?: string
}

interface AccountIdRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const body = await readBody<ActivateBody | null>(event).catch(() => null)
  const account = await activateEmailAccount(body?.token || '')
  const row = await queryRow<AccountIdRow>(
    `SELECT id FROM platform_accounts WHERE uid = ? LIMIT 1`,
    [account.uid]
  )

  if (!row) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load activated account'
    })
  }

  const sessionUuid = await createPlatformSession(event, {
    accountId: row.id,
    idpType: 'local_email',
    sessionScope: 'tenant_admin',
    ttlSeconds: Number(runtimeConfig.auth?.sessionTtlSeconds) || undefined
  })

  await touchAccountLogin(row.id)
  await markLocalEmailIdentityLogin(row.id)

  return ok({
    account,
    session: {
      sessionUuid,
      scope: 'tenant_admin'
    },
    redirect: normalizeRedirect(body?.redirect)
  })
})
