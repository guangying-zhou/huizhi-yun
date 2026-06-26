import type { H3Event } from 'h3'
import {
  type AuthorizationSimulationPolicyFingerprint,
  expireAuthorizationSimulationSessionIfNeeded
} from '~~/server/utils/authorizationSimulation'
import { resolveConsoleSession } from '~~/server/utils/authSession'
import { loadPolicyAuthorizationSnapshot } from '~~/server/utils/policyAuthorization'

async function loadCurrentPolicyFingerprint(event: H3Event, uid: string): Promise<AuthorizationSimulationPolicyFingerprint | null> {
  try {
    const snapshot = await loadPolicyAuthorizationSnapshot(uid, 'platform', event, {
      ignoreSimulationSession: true
    })
    return {
      bundleVersion: snapshot.bundleVersion,
      bundleHash: snapshot.bundleHash
    }
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const session = await resolveConsoleSession(event, { touch: false })
  const currentPolicy = await loadCurrentPolicyFingerprint(event, session.uid)
  const inspection = await expireAuthorizationSimulationSessionIfNeeded(event, session.uid, currentPolicy)
  const simulation = inspection.reason ? null : inspection.session

  return {
    code: 0,
    data: simulation
      ? {
          active: true,
          sid: simulation.sid,
          mode: simulation.mode,
          actorUid: simulation.actorUid,
          roleCode: simulation.roleCode,
          subjectCode: simulation.subjectCode,
          includeBaseline: simulation.includeBaseline,
          reason: simulation.reason,
          issuedAt: simulation.issuedAt,
          expiresAt: simulation.expiresAt,
          policyBundleVersion: simulation.policyBundleVersion,
          policyBundleHash: simulation.policyBundleHash
        }
      : {
          active: false
        }
  }
})
