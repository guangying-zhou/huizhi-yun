#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { verifyManifest } from './release-lib.mjs'

const { values } = parseArgs({ options: { dir: { type: 'string' }, app: { type: 'string' } } })
if (!values.dir || !values.app) throw Error('usage: verify.mjs --dir RELEASE --app APP')
// verifyManifest also applies the per-app payload rules (collab: bundle present,
// no .env or key files, no embedded client secret literal).
await verifyManifest(values.dir, { app: values.app })
