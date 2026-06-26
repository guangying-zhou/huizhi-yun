/**
 * 列出 company 子目录下的文件和目录
 * GET /api/company-assets/list?subdir=rules&path=
 */

interface OSSPrefix {
  name: string
  path: string
  isDirectory: boolean
}

interface OSSFile {
  name: string
  path: string
  size: number
  lastModified: string
  isDirectory: boolean
}

interface OSSListV2Result {
  prefixes?: string[]
  objects?: Array<{
    name: string
    size: number
    lastModified: string
  }>
  isTruncated?: boolean
  nextContinuationToken?: string
}

interface OSSClient {
  listV2(options: {
    'prefix': string
    'delimiter': string
    'continuation-token'?: string
    'max-keys': number
  }): Promise<OSSListV2Result>
}

export default defineEventHandler(async (event) => {
  const { subdir, path: subPath } = getQuery(event) as { subdir: string, path?: string }

  if (!subdir) {
    throw createError({ statusCode: 400, message: '缺少 subdir 参数' })
  }

  let prefix = `codocs/company/${subdir}/`
  if (subPath) {
    prefix += subPath.replace(/^\/+/, '')
    if (!prefix.endsWith('/')) prefix += '/'
  }

  const client = await createRuntimeOSSClient() as unknown as OSSClient
  const dirs: OSSPrefix[] = []
  const files: OSSFile[] = []

  // 使用 delimiter 只列出当前层级
  let continuationToken: string | undefined
  do {
    const result = await client.listV2({
      prefix,
      'delimiter': '/',
      'continuation-token': continuationToken,
      'max-keys': 500
    })

    // 子目录
    if (result.prefixes) {
      for (const p of result.prefixes) {
        const name = p.replace(prefix, '').replace(/\/$/, '')
        if (name) dirs.push({ name, path: p, isDirectory: true })
      }
    }

    // 文件
    if (result.objects) {
      for (const obj of result.objects) {
        const name = obj.name.replace(prefix, '')
        if (!name || name.endsWith('/')) continue // skip directory markers
        files.push({
          name,
          path: obj.name,
          size: obj.size,
          lastModified: obj.lastModified,
          isDirectory: false
        })
      }
    }

    continuationToken = result.isTruncated ? result.nextContinuationToken : undefined
  } while (continuationToken)

  // 文件按最后修改时间倒序排列
  files.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())

  return { code: 0, data: [...dirs, ...files] }
})
