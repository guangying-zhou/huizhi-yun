// Orchestration only: all process, database and filesystem effects are injected.
// Crossing the candidate start attempt is irreversible without a data fence:
// PM2 can start a writer and still return an error to its caller.
export async function runPlatformDatabaseCutover(dependencies) {
  let stage = 'stop'
  let candidateStartAttempted = false
  try {
    await dependencies.stopOriginal()
    stage = 'copy'
    await dependencies.copyDatabase()
    stage = 'verify'
    await dependencies.verifyDatabase()
    stage = 'start'
    candidateStartAttempted = true
    await dependencies.startCandidate()
    stage = 'health'
    if (await dependencies.waitForHealth() !== true) throw Error('candidate_unhealthy')
    stage = 'probe'
    await dependencies.probeCandidate()
    stage = 'process'
    await dependencies.verifyCandidateProcess()
    stage = 'others'
    await dependencies.assertOthers()
    stage = 'receipt'
    await dependencies.writeReceipt()
    stage = 'report'
    await dependencies.reportSuccess()
    return { success: true, candidateStartAttempted }
  } catch (error) {
    const reason = sanitizeCutoverFailureReason(error, dependencies.failureSecrets || [])
    let recovery
    if (!candidateStartAttempted) {
      try {
        await dependencies.restoreOriginal()
        recovery = 'original_restored'
      } catch {
        recovery = 'original_restore_failed'
      }
    } else {
      let healthy = false
      if (['others', 'receipt', 'report'].includes(stage)) {
        try { healthy = await dependencies.isCandidateHealthy() === true } catch {}
      }
      if (healthy) recovery = 'local_candidate_kept'
      else {
        try {
          await dependencies.stopCandidate()
          recovery = 'local_candidate_stopped'
        } catch {
          recovery = 'local_candidate_stop_failed'
        }
      }
    }
    const result = { success: false, stage, candidateStartAttempted, recovery, reason }
    await dependencies.reportFailure(result)
    return result
  }
}

export function platformDatabaseCutoverFailureMessage(result) {
  const prefix = `Cutover failed at ${result.stage}; recovery=${result.recovery}; reason=${result.reason}.`
  return result.candidateStartAttempted
    ? `${prefix} The local database remains authoritative; no remote rollback was started. Manual recovery: fence all writers, reverse catch-up from local to remote, verify a fenced checksum, then explicitly approve the process switch. PM2 startup/resurrect may revive an old remote writer after host reboot: the dump is not automatically saved by this failure handler. Fence restart/resurrect until an operator verifies and explicitly persists the intended process state. Do not resurrect the old PM2 dump or start rollback.config.json without this procedure.`
    : `${prefix} Candidate start was not attempted; only the verified original entry may be restored.`
}

export function sanitizeCutoverFailureReason(error, secrets = []) {
  let message = String(error?.message ?? error)
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length) message = message.split(secret).join('[redacted]')
  }
  message = message
    .replace(/(\b(?:password|passwd|secret|token|authorization|cookie|api[_-]?key)\b\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
    .replace(/[\r\n\x00-\x1f]/g, ' ')
  return message.slice(0, 200)
}
