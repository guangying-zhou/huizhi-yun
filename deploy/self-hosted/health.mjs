#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { checkCollabDeep, checkLoopbackListener } from './collab-probe.mjs'
import { localHealth } from './release.mjs'
import { PORTS } from './release-lib.mjs'

const { values } = parseArgs({ options: {
  app: { type: 'string' }, deep: { type: 'boolean', default: false },
  'gateway-url': { type: 'string' }, 'public-host': { type: 'string' }
} })
if (!values.app) throw Error('usage: health.mjs --app APP [--deep --gateway-url URL --public-host HOST]  (--deep is collab only)')
await localHealth(values.app)
if (values.app === 'collab') {
  // Local, read-only: the listener answers on 127.0.0.1 only. Runs from the unit's ExecStartPost.
  console.log(JSON.stringify({ app: 'collab', ...(await checkLoopbackListener({ port: PORTS.collab })) }))
  // Deep: through the Gateway ingress or the public entry (needs an allow-listed peer). Read-only and
  // sends no ticket: 101 for a bare handshake, 426 for a plain request.
  if (values.deep) {
    if (!values['gateway-url'] || !values['public-host']) throw Error('--deep requires --gateway-url and --public-host')
    console.log(JSON.stringify({ app: 'collab', ...(await checkCollabDeep({ port: PORTS.collab, gatewayUrl: values['gateway-url'], publicHost: values['public-host'] })) }))
  }
} else if (values.deep) throw Error('--deep is only defined for collab')
