import {
  clearAuthorizationSimulationSession,
  readAuthorizationSimulationSession,
  writeAuthorizationSimulationAudit
} from '~~/server/utils/authorizationSimulation'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'

export default defineEventHandler(async (event) => {
  const session = await resolveOptionalConsoleSession(event, { touch: false })
  const simulation = session ? readAuthorizationSimulationSession(event, session.uid) : null
  clearAuthorizationSimulationSession(event)

  if (session && simulation) {
    await writeAuthorizationSimulationAudit(event, {
      action: 'delete',
      actorUid: session.uid,
      sessionId: simulation.sid,
      mode: simulation.mode,
      roleCode: simulation.roleCode,
      subjectCode: simulation.subjectCode,
      includeBaseline: simulation.includeBaseline,
      reason: simulation.reason,
      expiresAt: simulation.expiresAt,
      policyBundleVersion: simulation.policyBundleVersion,
      policyBundleHash: simulation.policyBundleHash
    })
  }

  return {
    code: 0,
    data: {
      active: false
    }
  }
})
