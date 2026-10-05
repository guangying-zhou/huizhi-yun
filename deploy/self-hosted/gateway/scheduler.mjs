// Resident replacement for the Cloudflare cron triggers.
//
// Ticks fire on UTC epoch boundaries (every N minutes, no jitter), a job never
// overlaps itself, and each run records counters. Logs carry only numbers,
// enumerated stages and error class names — never messages, URLs or tokens.
import { safeName } from './log.mjs'

export const DRAIN_INTERVAL_MS = 5 * 60 * 1000
export const DRAIN_CRON = '*/5 * * * *'
export const POLICY_CRON = '* * * * *'

export function nextBoundary(now, intervalMs) {
  return (Math.floor(now / intervalMs) + 1) * intervalMs
}

/**
 * @param {object} options
 * @param {Array<{name: string, intervalMs: number, run: (scheduledTime: number) => Promise<unknown>,
 *   evaluate?: (result: unknown) => {ok: boolean, summary?: object}}>} options.jobs
 */
export function createScheduler({ jobs, log, alertAfter = 3, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const states = jobs.map(job => ({
    job,
    timer: null,
    running: null,
    counters: {
      runs: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      skippedOverlaps: 0,
      lastScheduledAt: null,
      lastFinishedAt: null,
      lastSuccessAt: null,
      lastDurationMs: null,
      lastOk: null,
      lastSummary: null
    }
  }))
  let stopped = true

  function arm(state, reference) {
    if (stopped) return
    const at = nextBoundary(reference, state.job.intervalMs)
    state.timer = setTimer(() => tick(state, at), Math.max(0, at - now()))
    state.timer?.unref?.()
  }

  function tick(state, scheduledTime) {
    // Re-arm from the later of "now" and the planned boundary so a late timer
    // never fires twice for one boundary and never drifts off UTC alignment.
    arm(state, Math.max(now(), scheduledTime))
    if (state.running) {
      state.counters.skippedOverlaps += 1
      log('gateway-scheduler-skipped', { job: state.job.name, reason: 'overlap', scheduledAt: iso(scheduledTime) })
      return
    }
    state.running = execute(state, scheduledTime).finally(() => { state.running = null })
  }

  async function execute(state, scheduledTime) {
    const { job, counters } = state
    const startedAt = now()
    counters.runs += 1
    counters.lastScheduledAt = scheduledTime
    let verdict
    try {
      const result = await job.run(scheduledTime)
      verdict = job.evaluate ? job.evaluate(result) : { ok: true }
    } catch (error) {
      verdict = { ok: false, summary: { stage: 'exception', errorName: safeName(error?.name) } }
    }
    const finishedAt = now()
    counters.lastFinishedAt = finishedAt
    counters.lastDurationMs = finishedAt - startedAt
    counters.lastOk = verdict.ok === true
    counters.lastSummary = verdict.summary || null
    if (verdict.ok === true) {
      counters.successes += 1
      counters.consecutiveFailures = 0
      counters.lastSuccessAt = finishedAt
    } else {
      counters.failures += 1
      counters.consecutiveFailures += 1
    }
    const alert = counters.consecutiveFailures >= alertAfter
    log(alert ? 'gateway-scheduler-alert' : 'gateway-scheduler-run', {
      job: job.name,
      ok: counters.lastOk,
      scheduledAt: iso(scheduledTime),
      durationMs: counters.lastDurationMs,
      consecutiveFailures: counters.consecutiveFailures,
      ...(verdict.summary ? { summary: verdict.summary } : {})
    })
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      for (const state of states) arm(state, now())
    },
    async stop() {
      stopped = true
      for (const state of states) if (state.timer) clearTimer(state.timer)
      await Promise.allSettled(states.map(state => state.running).filter(Boolean))
    },
    /** Test and operator hook: run one boundary immediately, honouring overlap protection. */
    trigger(name, scheduledTime = now()) {
      const state = states.find(item => item.job.name === name)
      if (!state) throw new Error('unknown job')
      if (state.running) {
        state.counters.skippedOverlaps += 1
        log('gateway-scheduler-skipped', { job: name, reason: 'overlap', scheduledAt: iso(scheduledTime) })
        return Promise.resolve({ skipped: true })
      }
      state.running = execute(state, scheduledTime).finally(() => { state.running = null })
      return state.running
    },
    snapshot() {
      return Object.fromEntries(states.map(state => [state.job.name, {
        intervalMs: state.job.intervalMs,
        running: Boolean(state.running),
        ...state.counters,
        lastScheduledAt: iso(state.counters.lastScheduledAt),
        lastFinishedAt: iso(state.counters.lastFinishedAt),
        lastSuccessAt: iso(state.counters.lastSuccessAt),
        alerting: state.counters.consecutiveFailures >= alertAfter
      }]))
    },
    degraded() {
      return states.some(state => state.counters.consecutiveFailures >= alertAfter)
    }
  }
}

/** Drain counters from the Worker are numeric plus an enumerated stop reason. */
export function evaluateDrain(counters) {
  const record = counters && typeof counters === 'object' ? counters : {}
  const numbers = {}
  for (const key of ['pages', 'tenants', 'maxWakes', 'attemptedWakes', 'succeededWakes', 'failedWakes', 'failedTenants']) {
    numbers[key] = Number.isSafeInteger(record[key]) ? record[key] : 0
  }
  const stoppedBy = ['empty', 'max_wall_time', 'max_wakes', 'max_tenants', 'max_pages'].includes(record.stoppedBy) ? record.stoppedBy : 'unknown'
  return {
    ok: numbers.tenants > 0 && numbers.failedWakes === 0 && numbers.failedTenants === 0,
    summary: { ...numbers, stoppedBy }
  }
}

export function evaluatePolicySync(results) {
  const list = Array.isArray(results) ? results : []
  const stages = ['registry', 'binding', 'bootstrap', 'headers', 'console', 'budget']
  const failed = list.filter(item => item?.ok !== true)
  return {
    ok: list.length > 0 && failed.length === 0,
    summary: {
      hosts: list.length,
      failed: failed.length,
      failures: failed.slice(0, 5).map(item => ({
        stage: stages.includes(item?.stage) ? item.stage : 'unknown',
        status: Number.isInteger(item?.status) ? item.status : 0
      }))
    }
  }
}

function iso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null
}
