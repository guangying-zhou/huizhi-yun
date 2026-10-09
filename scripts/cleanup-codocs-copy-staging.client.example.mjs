// Example --client-module factory for cleanup-codocs-copy-staging.mjs (aliyun-oss-native only).
//
// The Nuxt-runtime integration resolution (Console `integration-config` + credential vault)
// only works inside a running Nuxt/Nitro server, so this script cannot call it directly.
// Operators must provide the factory in a CONTROLLED environment, e.g. by copying this file
// outside the repo and supplying the OSS settings through the shell environment of that
// session (never committed, never printed):
//   HZY_CLEANUP_OSS_BUCKET, HZY_CLEANUP_OSS_ENDPOINT, HZY_CLEANUP_OSS_REGION,
//   HZY_CLEANUP_OSS_ACCESS_KEY_ID, HZY_CLEANUP_OSS_ACCESS_KEY_SECRET
// The bucket is shared by test and production: double-check the target before `--apply`.
// This module is only loaded when passed explicitly via --client-module.
import OSS from 'ali-oss'

export default async function createClient() {
  const need = (name) => {
    const value = String(process.env[name] || '').trim()
    if (!value) throw new Error(`Missing ${name}`) // name only; never echo values
    return value
  }
  return new OSS({
    bucket: need('HZY_CLEANUP_OSS_BUCKET'),
    endpoint: need('HZY_CLEANUP_OSS_ENDPOINT'),
    region: String(process.env.HZY_CLEANUP_OSS_REGION || '').trim() || undefined,
    accessKeyId: need('HZY_CLEANUP_OSS_ACCESS_KEY_ID'),
    accessKeySecret: need('HZY_CLEANUP_OSS_ACCESS_KEY_SECRET')
  })
}
