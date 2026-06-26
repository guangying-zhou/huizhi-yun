type EnvLike = Record<string, string | undefined>

function truthyEnv(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

export function isAssetsLocalDevAuthorizationBypassEnabled(env: EnvLike = process.env) {
  return truthyEnv(env.HZY_ASSETS_LOCAL_DEV_AUTH_BYPASS)
}
