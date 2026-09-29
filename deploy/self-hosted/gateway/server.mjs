#!/usr/bin/env node
// Self-hosted Tenant Gateway: runs the Cloudflare Worker source
// (deploy/cloudflare/tenant-gateway/src/index.js) under Node for one site.
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import worker, { runScheduledIntegrationDrains, runScheduledPolicyBundleSync } from '../../cloudflare/tenant-gateway/src/index.js'
import { allowedEgressOrigins, buildWorkerEnv, ConfigError, loadConfig, secretValues } from './config.mjs'
import { createEgressFetch, createServiceBinding, disabledBinding } from './egress.mjs'
import { createIngressHandler, createUpgradeHandler } from './http-bridge.mjs'
import { auditClientAddress, createPeerGuard, listenWithRetry } from './ingress-peers.mjs'
import { createLogger, createRedactor, installConsoleRedaction } from './log.mjs'
import { createScheduler, DRAIN_CRON, DRAIN_INTERVAL_MS, evaluateDrain, evaluatePolicySync, POLICY_CRON } from './scheduler.mjs'

/**
 * Build everything without binding sockets or starting timers, so tests can
 * drive the same objects production uses.
 */
export function createGatewayHost(config, { baseFetch = globalThis.fetch, log, now = Date.now, setTimer, clearTimer } = {}) {
  const egressFetch = createEgressFetch({
    allowedOrigins: allowedEgressOrigins(config),
    baseFetch,
    platformTimeoutMs: config.limits.platformTimeoutMs
  })
  const env = buildWorkerEnv(config, {
    createBinding: origin => createServiceBinding(origin, egressFetch),
    disabledBinding
  })
  const codocsBinding = config.apps.codocs ? createServiceBinding(config.apps.codocs.origin, egressFetch) : null
  const ingressListener = config.listeners.ingress
  const tailnet = ingressListener.mode === 'tailnet'
  const peerGuard = createPeerGuard(ingressListener, { log: log || (() => {}), now })
  const ingress = createServer({
    maxHeaderSize: config.limits.maxHeaderBytes,
    requestTimeout: config.limits.requestTimeoutMs,
    headersTimeout: 30_000,
    keepAliveTimeout: 65_000
  }, createIngressHandler({
    worker, env, config, log, codocsBinding, peerGuard,
    clientAddressFor: tailnet ? req => auditClientAddress(req, peerGuard) : null
  }))
  // Connection-time allowlist: runs before the HTTP parser, so a refused peer
  // gets no response, no request handling and no WebSocket upgrade.
  peerGuard.install(ingress)
  const upgrade = createUpgradeHandler({ config, log, peerGuard })
  ingress.on('upgrade', upgrade)
  ingress.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n')
    else socket.destroy()
  })

  // The static page replaces the Platform-wide scheduler shard: this host only
  // ever wakes its own site's configured local apps. Registry resolution and
  // the expected-binding check still run for every wake.
  const drainPage = async () => ({
    items: [{
      host: config.site.publicHost,
      tenantCode: config.site.tenantCode,
      environment: config.site.environment,
      appCodes: [...config.scheduler.drain.apps]
    }],
    nextCursor: null
  })
  const jobs = []
  if (config.scheduler.drain.enabled) {
    jobs.push({
      name: 'integration-drain',
      intervalMs: DRAIN_INTERVAL_MS,
      run: scheduledTime => runScheduledIntegrationDrains({ cron: DRAIN_CRON, scheduledTime }, env,
        { fetchImpl: egressFetch, loadPage: drainPage }),
      evaluate: evaluateDrain
    })
  }
  if (config.scheduler.policySync.enabled) {
    jobs.push({
      name: 'policy-sync',
      intervalMs: config.scheduler.policySync.intervalMinutes * 60 * 1000,
      run: () => runScheduledPolicyBundleSync(env, egressFetch),
      evaluate: evaluatePolicySync
    })
  }
  const scheduler = createScheduler({
    jobs,
    log,
    alertAfter: config.scheduler.alertAfterConsecutiveFailures,
    now,
    ...(setTimer ? { setTimer } : {}),
    ...(clearTimer ? { clearTimer } : {})
  })

  const startedAt = now()
  const health = createServer((req, res) => {
    const host = String(req.headers.host || '').toLowerCase()
    const local = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)
    const path = String(req.url || '').split('?')[0]
    if (!local || req.method !== 'GET' || !['/healthz', '/readyz'].includes(path)) {
      res.writeHead(404, { 'content-type': 'text/plain;charset=utf-8', 'cache-control': 'no-store' })
      res.end('Not Found')
      return
    }
    const degraded = scheduler.degraded()
    const status = path === '/readyz' && (degraded || !ingress.listening) ? 503 : 200
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({
      status: degraded ? 'degraded' : 'ok',
      site: { publicHost: config.site.publicHost, tenantCode: config.site.tenantCode, environment: config.site.environment },
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.floor((now() - startedAt) / 1000),
      ingressListening: ingress.listening,
      ingress: peerGuard.snapshot(),
      activeWebSockets: upgrade.activeCount(),
      scheduler: scheduler.snapshot()
    }))
  })

  return { env, egressFetch, ingress, health, scheduler, upgrade, peerGuard }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string' } } })
  let config
  try {
    config = await loadConfig(values.config || process.env.HZY_GATEWAY_CONFIG || '')
  } catch (error) {
    // Only validation issue texts are printed; they never contain values.
    console.error(error instanceof ConfigError ? error.message : 'Gateway configuration could not be loaded')
    process.exitCode = 78
    return
  }
  const redact = createRedactor(secretValues(config))
  installConsoleRedaction(redact)
  const log = createLogger(redact)
  // The Worker calls the global fetch for non-binding routes; route those
  // through the same allowlisted egress as the bindings.
  const nativeFetch = globalThis.fetch
  const host = createGatewayHost(config, { baseFetch: nativeFetch, log })
  globalThis.fetch = host.egressFetch

  await listenWithRetry(host.health, config.listeners.health)
  // A Tailscale address may not exist yet at boot (tailscaled still coming
  // up): retry EADDRNOTAVAIL with backoff; /readyz reports 503 meanwhile.
  await listenWithRetry(host.ingress, config.listeners.ingress, {
    retry: config.listeners.ingress.mode === 'tailnet',
    log
  })
  host.scheduler.start()
  log('gateway-started', {
    publicHost: config.site.publicHost,
    tenantCode: config.site.tenantCode,
    environment: config.site.environment,
    apps: Object.keys(config.apps),
    enterprisePilot: config.enterprise.pilot,
    ingressMode: config.listeners.ingress.mode,
    ingressAllowedPeers: config.listeners.ingress.allowedPeers.length,
    drain: config.scheduler.drain.enabled ? config.scheduler.drain.apps : false,
    policySyncMinutes: config.scheduler.policySync.enabled ? config.scheduler.policySync.intervalMinutes : false,
    cronEquivalent: [config.scheduler.drain.enabled ? DRAIN_CRON : null, config.scheduler.policySync.enabled && config.scheduler.policySync.intervalMinutes === 1 ? POLICY_CRON : null].filter(Boolean)
  })

  let stopping = false
  const shutdown = async (signal) => {
    if (stopping) return
    stopping = true
    log('gateway-stopping', { signal })
    const force = setTimeout(() => process.exit(0), 20_000)
    force.unref()
    host.ingress.close()
    host.ingress.closeIdleConnections?.()
    await host.scheduler.stop()
    host.health.close()
    process.exit(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(signal) })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Only a system error code (e.g. EADDRINUSE) is printed, never a message.
    const code = /^E[A-Z0-9_]{2,40}$/.test(String(error?.code || '')) ? ` (${error.code})` : ''
    console.error(`Gateway failed to start${code}; diagnostics suppressed.`)
    process.exitCode = 1
  })
}
