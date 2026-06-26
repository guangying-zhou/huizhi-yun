/**
 * 批量清理 OSS 上的历史遗留 .yjs 文件
 * DELETE /api/admin/cleanup-yjs
 * Query: { prefix?: string, dryRun?: 'true' }
 *
 * - 仅用于清理确认已废弃路径下的 .yjs 文件
 * - 扫描 Main Bucket 和 Projects Bucket 中所有 .yjs 文件
 * - dryRun=true 时只返回列表，不执行删除
 * - 默认扫描 codocs/ 和 recycle.bin/ 前缀
 */

import { createOSSClient, createProjectsOSSClient } from '~~/server/utils/oss'

interface OSSListV2Result {
  objects?: { name: string, size: number, lastModified: string }[]
  isTruncated: boolean
  nextContinuationToken?: string
}

type OSSClientWithListV2 = {
  listV2: (params: Record<string, unknown>) => Promise<OSSListV2Result>
  deleteMulti: (names: string[]) => Promise<void>
}

async function listYjsFiles(client: OSSClientWithListV2, prefix: string): Promise<{ name: string, size: number, lastModified: string }[]> {
  const files: { name: string, size: number, lastModified: string }[] = []
  let continuationToken: string | undefined

  do {
    const result = await client.listV2({
      prefix,
      'max-keys': 1000,
      'continuation-token': continuationToken
    })

    if (result.objects) {
      for (const obj of result.objects) {
        if (obj.name.endsWith('.yjs')) {
          files.push(obj)
        }
      }
    }

    continuationToken = result.isTruncated ? result.nextContinuationToken : undefined
  } while (continuationToken)

  return files
}

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const dryRun = query.dryRun === 'true'
    const prefix = (query.prefix as string) || ''

    const mainClient = createOSSClient() as unknown as OSSClientWithListV2
    const projectsClient = createProjectsOSSClient() as unknown as OSSClientWithListV2

    // 扫描 Main Bucket
    const prefixes = prefix ? [prefix] : ['codocs/', 'recycle.bin/']
    const mainFiles: { name: string, size: number, lastModified: string }[] = []
    for (const p of prefixes) {
      const files = await listYjsFiles(mainClient, p)
      mainFiles.push(...files)
    }

    // 扫描 Projects Bucket
    const projectFiles = await listYjsFiles(projectsClient, prefix || 'codocs/')

    const totalSize = [...mainFiles, ...projectFiles].reduce((sum, f) => sum + f.size, 0)

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        mainBucket: {
          count: mainFiles.length,
          files: mainFiles.map(f => ({ path: f.name, size: f.size, lastModified: f.lastModified }))
        },
        projectsBucket: {
          count: projectFiles.length,
          files: projectFiles.map(f => ({ path: f.name, size: f.size, lastModified: f.lastModified }))
        },
        totalCount: mainFiles.length + projectFiles.length,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100
      }
    }

    // 执行删除 - 每批最多 1000 个
    let deletedMain = 0
    for (let i = 0; i < mainFiles.length; i += 1000) {
      const batch = mainFiles.slice(i, i + 1000).map(f => f.name)
      if (batch.length > 0) {
        await mainClient.deleteMulti(batch)
        deletedMain += batch.length
      }
    }

    let deletedProjects = 0
    for (let i = 0; i < projectFiles.length; i += 1000) {
      const batch = projectFiles.slice(i, i + 1000).map(f => f.name)
      if (batch.length > 0) {
        await projectsClient.deleteMulti(batch)
        deletedProjects += batch.length
      }
    }

    return {
      success: true,
      dryRun: false,
      deletedMain,
      deletedProjects,
      totalDeleted: deletedMain + deletedProjects,
      freedSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100
    }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    console.error('Failed to cleanup yjs files:', error)
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || '清理 YJS 文件失败'
    })
  }
})
