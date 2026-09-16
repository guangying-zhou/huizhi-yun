// This rollout is specific to the user-approved replacement of the legacy PM2 entry.
export const platformDevOrigin = 'https://hzy.wiztek.cn'
export const previousDevOrigin = 'https://platform-dev.wiztek.cn'

export function updateDevelopmentUrls(env) {
  if (env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011') throw new Error('Not the development Platform')
  const next = { ...env }
  for (const name of ['PLATFORM_SERVICE_URL', 'PLATFORM_AUTH_ACTIVATION_BASE_URL', 'GOOGLE_OAUTH_REDIRECT_URI', 'WECOM_OAUTH_REDIRECT_URI',
    'NUXT_PUBLIC_SERVICE_URL', 'NUXT_AUTH_ACTIVATION_BASE_URL', 'NUXT_AUTH_GOOGLE_REDIRECT_URI', 'NUXT_AUTH_WECOM_REDIRECT_URI']) {
    if (!next[name]?.startsWith(previousDevOrigin) || new URL(next[name]).origin !== previousDevOrigin) throw new Error(`Unexpected URL: ${name}`)
    next[name] = platformDevOrigin + next[name].slice(previousDevOrigin.length)
  }
  return next
}

export function updateDevelopmentRouting(text) {
  let changed = 0
  const lines = text.split('\n')
  for (let start = 0; start < lines.length; start++) {
    if (!/^\s*server\s*\{\s*$/.test(lines[start])) continue
    let depth = 0, end = start
    for (; end < lines.length; end++) {
      const line = lines[end].replace(/#.*/, '')
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      if (depth === 0) break
    }
    if (depth !== 0) throw new Error('Unbalanced server configuration')
    const block = lines.slice(start, end + 1).join('\n')
    let next = block
    if (/server_name\s+hzy\.wiztek\.cn\s*;/.test(block) && /listen\s+443\s+ssl/.test(block)) {
      if ((block.match(/proxy_pass http:\/\/127\.0\.0\.1:3010;/g) || []).length !== 1) throw new Error('Unexpected legacy Platform upstream')
      next = block.replace('proxy_pass http://127.0.0.1:3010;', 'proxy_pass http://127.0.0.1:3011;')
      changed++
    } else if (/server_name\s+platform-dev\.wiztek\.cn\s*;/.test(block) && /listen\s+443\s+ssl/.test(block)) {
      const location = /location \/ \{[^{}]*\}/g
      const matches = block.match(location) || []
      if (matches.length !== 1 || !matches[0].includes('proxy_pass http://127.0.0.1:3011;')) throw new Error('Unexpected old development route')
      next = block.replace(location, 'location / {\n        return 308 https://hzy.wiztek.cn$request_uri;\n    }')
      changed++
    }
    lines.splice(start, end - start + 1, ...next.split('\n'))
    start += next.split('\n').length - 1
  }
  if (changed !== 2) throw new Error('Expected exactly two HTTPS virtual hosts')
  return lines.join('\n')
}
