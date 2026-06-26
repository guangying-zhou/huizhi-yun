import type { RowDataPacket } from 'mysql2/promise'
import { queryRow } from '~~/server/utils/db'

interface HealthRow extends RowDataPacket {
  currentKid: string | null
  activeClients: number
  activeSessions: number
  lastAuthError: string | null
  lastAuthErrorAt: string | null
}

export async function collectAuthRuntimeHealthSummary() {
  const row = await queryRow<HealthRow>(
    `SELECT
       (SELECT kid
          FROM auth_signing_keys
         WHERE status = 'current'
           AND (not_before IS NULL OR not_before <= UTC_TIMESTAMP())
           AND (not_after IS NULL OR not_after > UTC_TIMESTAMP())
         ORDER BY id DESC
         LIMIT 1) AS currentKid,
       (SELECT COUNT(*)
          FROM auth_clients
         WHERE status = 'active') AS activeClients,
       (SELECT COUNT(*)
          FROM local_sessions
         WHERE status = 'active'
           AND revoked_at IS NULL
           AND expires_at > UTC_TIMESTAMP()) AS activeSessions,
       (SELECT failure_reason
          FROM auth_token_events
         WHERE result = 'failed'
         ORDER BY created_at DESC, id DESC
         LIMIT 1) AS lastAuthError,
       (SELECT created_at
          FROM auth_token_events
         WHERE result = 'failed'
         ORDER BY created_at DESC, id DESC
         LIMIT 1) AS lastAuthErrorAt`
  )

  return {
    signingKid: row?.currentKid || null,
    activeClients: Number(row?.activeClients || 0),
    activeSessions: Number(row?.activeSessions || 0),
    lastAuthError: row?.lastAuthError || null,
    lastAuthErrorAt: row?.lastAuthErrorAt || null
  }
}
