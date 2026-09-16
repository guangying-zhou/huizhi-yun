import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { compareDataRuntimeVersions, dataRuntimeReleaseStaticSettings } from '~~/server/utils/dataRuntimeRelease'
import { approveDataRuntimeRelease } from '~~/server/utils/dataRuntimeReleaseRegistry'
import { queryRow } from '~~/server/utils/db'

interface AccountRow extends RowDataPacket { id: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const version = requireString(body.version, 'version').trim()
  const note = normalizeNullableString(body.note)?.trim().slice(0, 500) || null
  const uid = String(event.context.platformUid || '').trim()
  const account = uid
    ? await queryRow<AccountRow>('SELECT id FROM platform_accounts WHERE uid = ? LIMIT 1', [uid])
    : null
  const settings = dataRuntimeReleaseStaticSettings()
  const approved = await approveDataRuntimeRelease({
    version,
    releaseSigningKeyId: settings.releaseSigningKeyId,
    accountId: account?.id || null,
    ip: String(getRequestIP(event, { xForwardedFor: true }) || '').trim() || null,
    userAgent: String(getHeader(event, 'user-agent') || '').trim().slice(0, 500) || null,
    note,
    confirmRollback: body.confirmRollback === true,
    compareVersions: compareDataRuntimeVersions
  })

  return ok(approved)
})
