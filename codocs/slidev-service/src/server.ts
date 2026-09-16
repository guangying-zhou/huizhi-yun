/**
 * Slidev 渲染服务
 *
 * 独立部署的演示文稿渲染服务，提供：
 * 1. POST /render  - 写入 slides.md，dev server HMR 刷新，返回预览 URL
 * 2. POST /export  - 导出为 PDF/PPTX/PNG
 * 3. GET  /health  - 健康检查
 *
 * Slidev dev server 常驻运行，内容更新通过文件写入 + HMR 实现（毫秒级）。
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from 'fs'
import { join, resolve } from 'path'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import type { ChildProcess } from 'child_process'
import express from 'express'
import cors from 'cors'

const execFileAsync = promisify(execFile)

const PORT = parseInt(process.env.SLIDEV_SERVICE_PORT || '3040')
const SLIDEV_PORT = parseInt(process.env.SLIDEV_DEV_PORT || '3045')
const SLIDEV_PUBLIC_URL = process.env.SLIDEV_PUBLIC_URL || `http://localhost:${SLIDEV_PORT}`
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const ROOT = resolve(import.meta.dirname, '..')
const WORKSPACE = join(ROOT, 'workspace')
const EXPORTS_DIR = join(ROOT, 'exports')
const COVERS_DIR = join(ROOT, 'covers')
const SLIDEV_BIN = join(ROOT, 'node_modules', '.bin', 'slidev')
const VITE_CONFIG = join(WORKSPACE, 'vite.config.ts')

// 确保目录
mkdirSync(join(WORKSPACE, 'snippets'), { recursive: true })
mkdirSync(join(WORKSPACE, 'public'), { recursive: true })
mkdirSync(EXPORTS_DIR, { recursive: true })

// 将 node_modules 链接到 workspace，让 Slidev 在 workspace 内能解析到 vite 等依赖
const workspaceNodeModules = join(WORKSPACE, 'node_modules')
const rootNodeModules = join(ROOT, 'node_modules')
if (!existsSync(workspaceNodeModules) && existsSync(rootNodeModules)) {
  symlinkSync(rootNodeModules, workspaceNodeModules)
}

// 将 covers 链接到 workspace/public/covers，让 Slidev 通过 /covers/ 路径访问
const publicCoversLink = join(WORKSPACE, 'public', 'covers')
if (!existsSync(publicCoversLink) && existsSync(COVERS_DIR)) {
  symlinkSync(COVERS_DIR, publicCoversLink)
}

// 初始化 vite.config.ts（允许 iframe 嵌入 + 放开 fs）
if (!existsSync(VITE_CONFIG)) {
  writeFileSync(VITE_CONFIG, `
export default {
  server: {
    headers: {
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': '',
      'Access-Control-Allow-Origin': '${CORS_ORIGIN}'
    },
    fs: {
      strict: false
    },
    hmr: {
      protocol: 'ws',
      port: ${SLIDEV_PORT}
    }
  }
}
`, 'utf-8')
}

// ==================== Slidev Dev Server 管理 ====================

let devProcess: ChildProcess | null = null
let devReady = false
let startingPromise: Promise<void> | null = null

async function checkReady(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000)
    })
    return res.ok || res.status === 200 || res.status === 304
  } catch {
    return false
  }
}

async function waitForReady(port: number, maxWait: number = 60_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    if (await checkReady(port)) return true
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

function startDevServer(): Promise<void> {
  if (devReady && devProcess && !devProcess.killed) {
    return Promise.resolve()
  }
  if (startingPromise) return startingPromise

  startingPromise = (async () => {
    // 写占位内容确保 server 能启动
    if (!existsSync(join(WORKSPACE, 'slides.md'))) {
      writeFileSync(join(WORKSPACE, 'slides.md'), '---\ntheme: seriph\n---\n\n# Slidev Service Ready\n', 'utf-8')
    }

    console.log(`[Slidev] Starting dev server on port ${SLIDEV_PORT}...`)

    const proc = spawn(
      SLIDEV_BIN,
      ['slides.md', '--port', String(SLIDEV_PORT), '--open', 'false', '--remote'],
      {
        cwd: WORKSPACE,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'development' }
      }
    )
    devProcess = proc

    // 定期写入空数据保持 stdin 打开，防止 Slidev 检测到 EOF 退出
    const keepAlive = setInterval(() => {
      try {
        proc.stdin?.write('')
      } catch {
        // ignore
      }
    }, 5000)
    proc.on('exit', () => clearInterval(keepAlive))

    proc.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) console.log(`[Slidev] ${msg.slice(0, 200)}`)
    })
    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg && !msg.includes('WARN') && !msg.includes('deprecat')) {
        console.error(`[Slidev] ${msg.slice(0, 200)}`)
      }
    })
    proc.on('error', (err) => {
      console.error('[Slidev] Process error:', err.message)
      devProcess = null
      devReady = false
      startingPromise = null
    })
    proc.on('exit', (code) => {
      console.log(`[Slidev] Exited with code ${code}`)
      devProcess = null
      devReady = false
      startingPromise = null
    })

    const ready = await waitForReady(SLIDEV_PORT, 60_000)
    if (ready) {
      devReady = true
      console.log(`[Slidev] Ready on port ${SLIDEV_PORT}`)
    } else {
      proc.kill()
      devProcess = null
      throw new Error('Slidev dev server 启动超时')
    }
    startingPromise = null
  })()

  return startingPromise
}

// ==================== 内容预处理 ====================

// 固定的全局配置（不随文稿内容变化，避免 Slidev 重启）
const FIXED_FRONTMATTER = [
  'title: Slides',
  'theme: seriph',
  'transition: slide-left',
  'mdc: true',
  'drawings:',
  '  persist: false'
].join('\n')

function preprocessContent(content: string): string {
  let processed = content
    .replace(/\n\*\*\*\n/g, '\n---\n')
    .replace(/\n___\n/g, '\n---\n')

  // 移除可能导致解析错误的高级语法
  processed = processed.replace(/^<<<\s+@.*$/gm, '') // 外部代码片段引用
  processed = processed.replace(/\{monaco(?:-run)?\}/g, '') // Monaco 编辑器标记
  processed = processed.replace(/^src:\s+\.\/.*$/gm, '') // 外部 slide 引用

  // background: default → 随机封面图
  const coversUrl = process.env.COVERS_URL || (process.env.NODE_ENV === 'production' ? 'https://codocs.wiztek.cn/api/covers' : 'http://localhost:3001/api/covers')
  processed = processed.replace(
    /^(\s*background:\s*)default\s*$/gm,
    `background: ${coversUrl}`
  )

  // 提取用户 frontmatter 中的内容字段（title, background, info, class 等），丢弃配置字段
  let userFields = ''
  let body = processed

  if (processed.startsWith('---\n')) {
    const fmEnd = processed.indexOf('\n---\n', 4)
    if (fmEnd > 0) {
      const fmBlock = processed.slice(4, fmEnd)
      body = processed.slice(fmEnd + 5)

      // 只保留内容相关字段，过滤掉会触发 Slidev 重启的配置字段
      const configKeys = new Set(['title', 'theme', 'transition', 'mdc', 'drawings', 'css', 'fonts', 'colorSchema', 'routerMode', 'selectable', 'record', 'exportFilename', 'monaco', 'remoteAssets', 'download', 'highlighter', 'lineNumbers', 'favicon', 'htmlAttrs'])
      const lines = fmBlock.split('\n')
      const kept: string[] = []
      let skipBlock = false

      for (const line of lines) {
        const isIndented = line.startsWith('  ') || line.startsWith('\t')
        const isEmpty = line.trim() === ''

        // 缩进行或空行属于上一个字段的多行值
        if ((isIndented || isEmpty) && skipBlock) continue

        // 非缩进非空行：新的顶层字段
        if (!isIndented && !isEmpty) {
          const keyMatch = line.match(/^(\w[\w-]*):\s*/)
          if (keyMatch && configKeys.has(keyMatch[1]!)) {
            skipBlock = true
            continue
          }
          skipBlock = false

          // 跳过注释行
          if (line.trimStart().startsWith('#')) continue
        }

        if (!skipBlock) kept.push(line)
      }

      userFields = kept.length > 0 ? '\n' + kept.join('\n') : ''
    }
  }

  return `---\n${FIXED_FRONTMATTER}${userFields}\n---\n\n${body.trim()}\n`
}

// ==================== Express Server ====================

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 静态文件服务
app.use('/exports', express.static(EXPORTS_DIR, { maxAge: '1d' }))
app.use('/covers', express.static(COVERS_DIR, { maxAge: '7d' }))

// 随机封面图：每次重定向到一张随机图片
const coverFiles = existsSync(COVERS_DIR)
  ? readdirSync(COVERS_DIR).filter(f => /\.(webp|jpg|jpeg|png)$/i.test(f))
  : []

app.get('/cover', (_req, res) => {
  if (coverFiles.length === 0) {
    res.redirect('https://cover.sli.dev')
    return
  }
  const file = coverFiles[Math.floor(Math.random() * coverFiles.length)]
  res.redirect(`/covers/${file}`)
})

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', devReady, slidevPort: SLIDEV_PORT })
})

// 读取当前 slides.md 内容（用户在 Slidev 编辑器中修改后的最新内容）
app.get('/content', (_req, res) => {
  try {
    const slidesPath = join(WORKSPACE, 'slides.md')
    if (!existsSync(slidesPath)) {
      res.status(404).json({ error: 'slides.md 不存在' })
      return
    }
    const content = readFileSync(slidesPath, 'utf-8')
    res.json({ success: true, data: { content } })
  } catch (err: unknown) {
    const error = err as { message?: string }
    res.status(500).json({ error: error.message || '读取失败' })
  }
})

// 获取示例文稿内容
app.get('/demo', (_req, res) => {
  try {
    const demoPath = join(ROOT, 'Demo.md')
    if (!existsSync(demoPath)) {
      res.status(404).json({ error: 'Demo.md 不存在' })
      return
    }
    const content = readFileSync(demoPath, 'utf-8')
    res.json({ success: true, data: { content } })
  } catch (err: unknown) {
    const error = err as { message?: string }
    res.status(500).json({ error: error.message || '读取失败' })
  }
})

// 渲染请求：写入 slides.md，返回预览 URL
app.post('/render', async (req, res) => {
  try {
    const { content } = req.body as { content?: string }
    if (!content) {
      res.status(400).json({ error: '缺少 content 参数' })
      return
    }

    await startDevServer()

    const processed = preprocessContent(content)
    writeFileSync(join(WORKSPACE, 'slides.md'), processed, 'utf-8')

    res.json({
      success: true,
      data: {
        url: `${SLIDEV_PUBLIC_URL}/`,
        port: SLIDEV_PORT
      }
    })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[Render] Error:', error.message)
    res.status(500).json({ error: error.message || '渲染失败' })
  }
})

// 导出请求：PDF / PPTX / PNG
app.post('/export', async (req, res) => {
  try {
    const { content, format = 'pdf', filename = 'slides' } = req.body as {
      content?: string
      format?: 'pdf' | 'pptx' | 'png' | 'md'
      filename?: string
    }

    if (!content) {
      res.status(400).json({ error: '缺少 content 参数' })
      return
    }

    // 确保 dev server 就绪（export 需要连接 dev server）
    await startDevServer()

    const processed = preprocessContent(content)
    writeFileSync(join(WORKSPACE, 'slides.md'), processed, 'utf-8')

    // 等待 HMR 刷新
    await new Promise(r => setTimeout(r, 1000))

    const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')
    const ext = format === 'pptx' ? 'pptx' : format === 'png' ? 'zip' : format === 'md' ? 'md' : 'pdf'
    const outputFile = join(EXPORTS_DIR, `${safeFilename}.${ext}`)

    console.log(`[Export] Starting ${format} export: ${safeFilename}`)

    const args = [
      'export', 'slides.md',
      '--format', format,
      '--output', outputFile,
      '--timeout', '30000'
    ]

    await execFileAsync(SLIDEV_BIN, args, {
      cwd: WORKSPACE,
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: 'production' }
    })

    console.log(`[Export] Complete: ${outputFile}`)

    res.json({
      success: true,
      data: {
        url: `/exports/${safeFilename}.${ext}`,
        filename: `${safeFilename}.${ext}`
      }
    })
  } catch (err: unknown) {
    const error = err as { message?: string, stderr?: string }
    console.error('[Export] Error:', error.message)
    if (error.stderr) console.error('[Export] stderr:', error.stderr.slice(0, 300))
    res.status(500).json({ error: '导出失败', detail: error.message })
  }
})

// 启动服务
app.listen(PORT, () => {
  console.log(`[Slidev Service] API running on port ${PORT}`)
  console.log(`[Slidev Service] Dev server port: ${SLIDEV_PORT}`)
  console.log(`[Slidev Service] Public URL: ${SLIDEV_PUBLIC_URL}`)

  // 预热：启动 dev server
  startDevServer().catch((err) => {
    console.error('[Slidev Service] Preheat failed:', err.message)
  })
})

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[Slidev Service] Shutting down...')
  devProcess?.kill()
  process.exit(0)
})
process.on('SIGINT', () => {
  devProcess?.kill()
  process.exit(0)
})
