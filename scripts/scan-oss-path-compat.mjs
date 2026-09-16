#!/usr/bin/env node
/**
 * scan-oss-path-compat: 检查 OSS 存量对象 key 是否兼容新版路径校验规则。
 *
 * 背景：角色授权模型发布批次为 codocs（及各应用同款头像代理）新增了 OSS 路径规范化：
 *   - /api/oss/avatar  头像段字符白名单 + 扩展名白名单（codocs/server/api/oss/avatar.ts）
 *   - /api/oss/image   图片段字符白名单 + 图片扩展名白名单（codocs/server/utils/ossImagePath.ts）
 *   - company/departments 资产路径规则（codocs/server/utils/assetOssPath.ts）
 * 存量对象若命中违规，发布后对应请求会 400。本脚本离线校验 key 清单，零依赖、只读。
 *
 * 用法：
 *   node scripts/scan-oss-path-compat.mjs --file keys.txt [--max-samples 20] [--json report.json]
 *   cat keys.txt | node scripts/scan-oss-path-compat.mjs
 *
 * keys.txt：每行一个对象 key（允许 oss://bucket/ 前缀，自动剥离；以 / 结尾的目录占位行忽略）。
 * 生成清单示例：
 *   ossutil64 ls oss://<bucket>/ -s > keys.txt
 *   aws s3 ls s3://<bucket> --recursive | awk '{print $4}' > keys.txt
 *   mc ls -r --json <alias>/<bucket> | jq -r .key > keys.txt
 *
 * 退出码：0 无违规；1 存在违规；2 参数/输入错误。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/
const AVATAR_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pic', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg'
])
const CODOCS_USER_IMAGE_PATTERN = /^codocs\/users\/[^/]+\/images\/[^/]+\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|pic|tiff|tif|heic|heif|avif)$/i

function usage() {
  return `
用法:
  node scripts/scan-oss-path-compat.mjs --file <keys.txt> [--max-samples 20] [--json report.json]
  cat keys.txt | node scripts/scan-oss-path-compat.mjs
`
}

function parseArgs(argv) {
  const args = { file: '', maxSamples: 20, json: '' }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--file') args.file = argv[++i] || ''
    else if (arg === '--max-samples') args.maxSamples = Number(argv[++i]) || 20
    else if (arg === '--json') args.json = argv[++i] || ''
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage())
      process.exit(0)
    } else {
      process.stderr.write(`未知参数: ${arg}\n${usage()}`)
      process.exit(2)
    }
  }
  return args
}

function normalizeKeyLine(line) {
  let key = String(line || '').trim()
  if (!key || key.startsWith('#')) return ''
  key = key.replace(/^oss:\/\/[^/]+\//, '')
  if (key.endsWith('/')) return ''
  return key
}

function extensionOf(fileName) {
  return fileName.includes('.') ? String(fileName.split('.').pop() || '').toLowerCase() : ''
}

function hasControlCharacter(value) {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function segmentIssues(path) {
  const segments = path.split('/')
  const bad = segments.filter(segment => !segment || segment === '.' || segment === '..' || !SEGMENT_PATTERN.test(segment))
  return bad.length ? `非法段: ${bad.slice(0, 3).map(s => JSON.stringify(s)).join(', ')}` : ''
}

// —— 规则实现，与服务端逐条对应 ——

// codocs/altoc/assets/console /api/oss/avatar：key 形如 avatars/<path>
function checkAvatar(key) {
  const path = key.slice('avatars/'.length)
  if (!path) return '空头像路径'
  if (path.length > 200) return '路径超过 200 字符'
  if (path.includes('\\')) return '包含反斜杠'
  const seg = segmentIssues(path)
  if (seg) return seg
  const ext = extensionOf(path.split('/').at(-1) || '')
  if (!ext || !AVATAR_EXTENSIONS.has(ext)) return `头像扩展名不允许: .${ext || '(无)'}`
  return ''
}

// codocs /api/oss/image（normalizeImageObjectPath）：任何经图片代理引用的 key
function checkImageProxy(key) {
  if (key.length > 500) return '路径超过 500 字符'
  if (key.includes('\\')) return '包含反斜杠'
  const seg = segmentIssues(key)
  if (seg) return seg
  const ext = extensionOf(key.split('/').at(-1) || '')
  if (!ext || !IMAGE_EXTENSIONS.has(ext)) return `图片扩展名不允许: .${ext || '(无)'}`
  return ''
}

// codocs normalizeCodocsUserImageObjectPath 严格模式
function checkCodocsUserImage(key) {
  return CODOCS_USER_IMAGE_PATTERN.test(key) ? '' : '不匹配 codocs/users/<uid>/images/<file>.<img-ext> 严格模式'
}

// codocs assetOssPath：company / departments 资产路径
function checkAssetPath(key, kind) {
  if (key.length > 800) return '路径超过 800 字符'
  if (key.includes('\\')) return '包含反斜杠'
  if (hasControlCharacter(key)) return '包含控制字符'
  const segments = key.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '包含空段或 . / .. 段'
  if (kind === 'department' && (segments.length < 4 || !segments[2] || !segments[3])) {
    return '部门资产路径少于 codocs/departments/<dept>/<subdir>/... 四段'
  }
  return ''
}

function classify(key) {
  const findings = []

  if (key.startsWith('avatars/')) {
    const reason = checkAvatar(key)
    if (reason) findings.push({ rule: 'avatar-proxy', reason })
  }

  const fileName = key.split('/').at(-1) || ''
  const ext = extensionOf(fileName)
  const underImagesDir = key.split('/').slice(0, -1).includes('images')
  const looksLikeImage = IMAGE_EXTENSIONS.has(ext)
  if (looksLikeImage || underImagesDir) {
    const reason = checkImageProxy(key)
    if (reason) findings.push({ rule: 'image-proxy', reason })
  }

  if (/^codocs\/users\/[^/]+\/images\//.test(key)) {
    const reason = checkCodocsUserImage(key)
    if (reason) findings.push({ rule: 'codocs-user-image(strict)', reason })
  }

  if (key.startsWith('codocs/company/')) {
    const reason = checkAssetPath(key, 'company')
    if (reason) findings.push({ rule: 'company-assets', reason })
  }
  if (key.startsWith('codocs/departments/')) {
    const reason = checkAssetPath(key, 'department')
    if (reason) findings.push({ rule: 'department-assets', reason })
  }

  return findings
}

function main() {
  const args = parseArgs(process.argv)
  let raw = ''
  if (args.file) {
    try {
      raw = readFileSync(args.file, 'utf8')
    } catch (error) {
      process.stderr.write(`读取失败: ${args.file}: ${error.message}\n`)
      process.exit(2)
    }
  } else if (!process.stdin.isTTY) {
    raw = readFileSync(0, 'utf8')
  } else {
    process.stderr.write(usage())
    process.exit(2)
  }

  const stats = { total: 0, checked: 0, violations: 0 }
  const byRule = new Map()

  for (const line of raw.split(/\r?\n/)) {
    const key = normalizeKeyLine(line)
    if (!key) continue
    stats.total += 1

    const findings = classify(key)
    if (!findings.length) {
      stats.checked += 1
      continue
    }
    stats.checked += 1
    stats.violations += 1
    for (const finding of findings) {
      if (!byRule.has(finding.rule)) byRule.set(finding.rule, [])
      byRule.get(finding.rule).push({ key, reason: finding.reason })
    }
  }

  process.stdout.write(`扫描对象: ${stats.total}，违规对象: ${stats.violations}\n`)
  for (const [rule, items] of byRule) {
    process.stdout.write(`\n[${rule}] ${items.length} 项\n`)
    for (const item of items.slice(0, args.maxSamples)) {
      process.stdout.write(`  - ${item.key}\n      ${item.reason}\n`)
    }
    if (items.length > args.maxSamples) {
      process.stdout.write(`  ...（其余 ${items.length - args.maxSamples} 项，用 --json 导出全量）\n`)
    }
  }

  if (args.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      stats,
      violations: Object.fromEntries([...byRule.entries()])
    }
    writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`\n完整报告已写入 ${args.json}\n`)
  }

  process.exit(stats.violations ? 1 : 0)
}

main()
