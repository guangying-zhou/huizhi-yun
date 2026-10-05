import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { dataRuntimeReleaseStaticSettings } from '~~/server/utils/dataRuntimeRelease'
import { fetchVerifiedDataRuntimeRelease, storeDataRuntimeRelease } from '~~/server/utils/dataRuntimeReleaseRegistry'
import { queryRow } from '~~/server/utils/db'

interface AccountRow extends RowDataPacket { id: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const version = String(body.version || 'latest').trim()
  const settings = dataRuntimeReleaseStaticSettings()
  const release = await fetchVerifiedDataRuntimeRelease({
    version,
    packageBaseUrl: settings.packageBaseUrl,
    releasePublicKeyPem: settings.releasePublicKeyPem,
    releaseSigningKeyId: settings.releaseSigningKeyId
  })
  const uid = String(event.context.platformUid || '').trim()
  const account = uid
    ? await queryRow<AccountRow>('SELECT id FROM platform_accounts WHERE uid = ? LIMIT 1', [uid])
    : null
  const stored = await storeDataRuntimeRelease(release, {
    accountId: account?.id || null,
    ip: String(getRequestIP(event, { xForwardedFor: true }) || '').trim() || null,
    userAgent: String(getHeader(event, 'user-agent') || '').trim().slice(0, 500) || null
  })

  return ok({ release: stored })
})
