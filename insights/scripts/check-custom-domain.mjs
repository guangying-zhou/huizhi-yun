#!/usr/bin/env node
/**
 * 自定义域名租户可用性测试脚本
 * 用途：验证一个 Cloudflare 自定义 Hostname 是否正确回源并被应用解析为指定租户。
 *
 * 功能：
 *  1. 请求 https://<domain>/?_debugTenant=1 读取解析 JSON
 *  2. 校验 tenant.type / businessName / (可选) businessId
 *  3. 访问首页 https://<domain>/ 验证 200 (或 2xx) 并抽取部分内容（标题或长度）
 *  4. 打印结构化结果 & 使用退出码表示成功/失败
 *
 * 用法：
 *  node scripts/check-custom-domain.mjs --domain repoinsight.com --expectBusiness repoinsight \
 *       [--expectBusinessId abc123] [--retries 5] [--interval 3000] [--insecure]
 *
 *  --insecure: 跳过 TLS 证书校验（仅 debug）
 */

import https from 'node:https'
import { execSync } from 'node:child_process'

function parseArgs() {
  const args = process.argv.slice(2)
  const cfg = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (!next || next.startsWith('--')) {
        cfg[key] = true
      } else {
        cfg[key] = next
        i++
      }
    }
  }
  return cfg
}

const opts = parseArgs()
if (!opts.domain || !opts.expectBusiness) {
  console.error('用法: node scripts/check-custom-domain.mjs --domain <domain> --expectBusiness <name> [--expectBusinessId id]')
  process.exit(2)
}

const DOMAIN = opts.domain
const EXPECT_BUSINESS = opts.expectBusiness
const EXPECT_COMPANY = opts.expectBusinessId || null
const RETRIES = parseInt(opts.retries || '1', 10)
const INTERVAL = parseInt(opts.interval || '3000', 10)
const INSECURE = !!opts.insecure

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function fetchJson(path) {
  const url = `https://${DOMAIN}${path}`
  return new Promise((resolve, reject) => {
    const agent = INSECURE ? new https.Agent({ rejectUnauthorized: false }) : undefined
    https.get(url, { agent, headers: { 'User-Agent': 'DomainCheck/1.0' } }, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        try {
          const json = JSON.parse(body)
          resolve({ status: res.statusCode, json, raw: body, headers: res.headers })
        } catch (e) {
          reject(new Error('JSON 解析失败: ' + e.message + '\nBody: ' + body.slice(0, 400)))
        }
      })
    }).on('error', reject)
  })
}

function fetchText(path) {
  const url = `https://${DOMAIN}${path}`
  return new Promise((resolve, reject) => {
    const agent = INSECURE ? new https.Agent({ rejectUnauthorized: false }) : undefined
    https.get(url, { agent, headers: { 'User-Agent': 'DomainCheck/1.0' } }, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, text: body, headers: res.headers })
      })
    }).on('error', reject)
  })
}

async function attempt() {
  const start = Date.now()
  const debugRes = await fetchJson('/?_debugTenant=1')
  const tenant = debugRes.json.tenant || null
  const result = {
    domain: DOMAIN,
    status: 'pending',
    debugStatus: debugRes.status,
    tenant,
    checks: []
  }
  // 校验 tenant 存在
  if (!tenant) {
    result.checks.push({ name: 'tenant_present', pass: false, msg: '未解析到 tenant' })
  } else {
    result.checks.push({ name: 'tenant_present', pass: true })
    result.checks.push({ name: 'tenant_type', pass: tenant.type === 'custom' || tenant.type === 'platform', expect: 'custom|platform', actual: tenant.type })
    result.checks.push({ name: 'business_match', pass: tenant.businessName === EXPECT_BUSINESS, expect: EXPECT_BUSINESS, actual: tenant.businessName })
    if (EXPECT_COMPANY) {
      result.checks.push({ name: 'business_match', pass: tenant.businessId === EXPECT_COMPANY, expect: EXPECT_COMPANY, actual: tenant.businessId })
    }
  }

  // 访问首页
  const pageRes = await fetchText('/')
  result.homeStatus = pageRes.status
  result.checks.push({ name: 'home_status_2xx', pass: pageRes.status && pageRes.status >= 200 && pageRes.status < 300, actual: pageRes.status })
  const snippet = (pageRes.text || '').replace(/\s+/g, ' ').slice(0, 160)
  result.snippet = snippet

  // 额外：提取 <title>
  const titleMatch = pageRes.text.match(/<title>(.*?)<\/title>/i)
  if (titleMatch) {
    result.title = titleMatch[1]
  }

  const duration = Date.now() - start
  result.durationMs = duration
  const allPass = result.checks.every(c => c.pass)
  result.status = allPass ? 'ok' : 'fail'
  return { allPass, result }
}

;(async () => {
  for (let i = 1; i <= RETRIES; i++) {
    try {
      const { allPass, result } = await attempt()
      console.log(`[Attempt ${i}] ${result.status}`)
      console.log(JSON.stringify(result, null, 2))
      if (allPass) process.exit(0)
      if (i < RETRIES) {
        console.log(`等待 ${INTERVAL}ms 后重试...`)
        await sleep(INTERVAL)
      } else {
        process.exit(1)
      }
    } catch (e) {
      console.error(`[Attempt ${i}] 错误:`, e.message)
      if (i < RETRIES) {
        await sleep(INTERVAL)
      } else {
        process.exit(1)
      }
    }
  }
})()
