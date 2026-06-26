#!/usr/bin/env node
/**
 * Environment validation script (Plan A)
 * Run with: pnpm run check:env
 * Fails (exit 1) if required variables are missing or clearly insecure.
 */

const required = []
const missing = []
const weak = []

// Load dotenv manually so script can be run outside Nuxt lifecycle
import fs from 'fs'
import path from 'path'

// Pick env file (.env.prod if NODE_ENV=production else .env.dev) when present
const mode = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
const candidate = [`.env.${mode}`, '.env'].find(f => fs.existsSync(path.join(process.cwd(), f)))
if (candidate) {
  const dotenv = await import('node:process') // placeholder to satisfy ESM dynamic needs
  // lightweight manual parse to avoid adding dependency
  const content = fs.readFileSync(path.join(process.cwd(), candidate), 'utf8')
  for (const line of content.split(/\n+/)) {
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    if (!(key in process.env)) {
      const rawVal = line.slice(idx + 1).trim()
      // remove optional surrounding quotes
      const val = rawVal.replace(/^['"]|['"]$/g, '')
      process.env[key] = val
    }
  }
}

const env = process.env
const isProd = env.NODE_ENV === 'production'

// Core always-required vars
const ALWAYS = [
  'NUXT_PUBLIC_PLATFORM_ROOT_DOMAINS',
  'NUXT_PUBLIC_BASE_DOMAIN',
  'NUXT_PUBLIC_SITE_URL',
  'TURSO_DB_URL',
  'TURSO_DB_TOKEN',
  'AUTH_SECRET',
  'NUXT_SESSION_PASSWORD'
]

ALWAYS.forEach(v => { if (!env[v]) missing.push(v) })

if (env.NUXT_SESSION_PASSWORD && env.NUXT_SESSION_PASSWORD.length < 32) weak.push('NUXT_SESSION_PASSWORD (<32 chars)')
if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32) weak.push('AUTH_SECRET (<32 chars)')

// OAuth (Google) strongly recommended in both envs
if (!env.NUXT_OAUTH_GOOGLE_CLIENT_ID) missing.push('NUXT_OAUTH_GOOGLE_CLIENT_ID')
if (!env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET) missing.push('NUXT_OAUTH_GOOGLE_CLIENT_SECRET')

// Email provider conditional
if (env.EMAIL_PROVIDER === 'resend') {
  ['FROM_EMAIL', 'RESEND_API_KEY'].forEach(v => { if (!env[v]) missing.push(v) })
}

// Stripe conditional
if (env.PAYMENT_PROVIDER === 'stripe') {
  ['STRIPE_PUBLIC_KEY', 'stripeSecretKey'].forEach(v => { if (!env[v]) missing.push(v) })
  if (isProd && !env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET (prod)')
}

// Custom domains automation conditional
if (env.PLATFORM_CNAME_TARGET) {
  ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_PAGES_PROJECT_NAME', 'CF_ZONE_ID', 'INTERNAL_CRON_TOKEN'].forEach(v => { if (!env[v]) missing.push(v) })
}

// Storage conditional
if (env.STORAGE_PROVIDER === 'S3') {
  ['S3_ENDPOINT','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_BUCKET_NAME'].forEach(v => { if (!env[v]) missing.push(v) })
}

// Output
const ok = missing.length === 0 && weak.length === 0
const red = s => `\x1b[31m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`

console.log('\n=== Environment Validation ===')
console.log('Mode:', isProd ? 'production' : 'development')

if (missing.length) {
  console.log(red('\nMissing:'))
  missing.forEach(v => console.log('  -', v))
}
if (weak.length) {
  console.log(yellow('\nWeak / Insecure:'))
  weak.forEach(v => console.log('  -', v))
}

if (ok) {
  console.log('\n' + green('✔ Environment looks good.'))
  process.exit(0)
} else {
  console.log('\n' + red('✖ Environment issues detected.'))
  process.exit(1)
}
