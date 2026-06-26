/**
 * OSS 工具函数
 *
 * 阿里云 OSS 文档存储操作
 */

import { createAliOssCompatibleClient, type AliOssCompatibleClient } from '@hzy/foundation/server/utils/objectStorage'
import { v4 as uuidv4 } from 'uuid'
import { getCodocsOssRuntimeConfig, loadCodocsOssRuntimeConfigFromConsole } from './ossRuntime'

// OSS 错误类型
interface OSSError extends Error {
  code?: string
}

// OSS listV2 结果类型
interface OSSListV2Result {
  objects?: { name: string, size: number, lastModified: string }[]
  isTruncated: boolean
  nextContinuationToken?: string
}

type CodocsOssRuntimeConfig = {
  provider?: string
  bucketName?: string
  region?: string
  accessKeyId?: string
  accessKeySecret?: string
  endpoint?: string
  bucketDomain?: string
  forcePathStyle?: boolean | string
  projectsBucketName?: string
  projectsEndpoint?: string
  projectsBucketDomain?: string
  imagesBucketName?: string
  imagesEndpoint?: string
  imagesBucketDomain?: string
  recycleDays?: number
}

export type OSSClientOptions = {
  timeout?: number
}

type OSSUserMeta = Record<string, string | number>

const DEFAULT_DOCUMENT_OSS_TIMEOUT_MS = 8000

function stringValue(value: unknown) {
  return String(value || '').trim()
}

const getResolvedOSSRuntimeConfig = (): CodocsOssRuntimeConfig => {
  const config = useRuntimeConfig() as unknown as { oss?: Record<string, unknown> }
  return getCodocsOssRuntimeConfig(config.oss || {}) as CodocsOssRuntimeConfig
}

// 获取 OSS 配置
const getOSSConfig = () => {
  const oss = getResolvedOSSRuntimeConfig()
  return {
    provider: stringValue(oss.provider),
    bucket: stringValue(oss.bucketName),
    region: stringValue(oss.region),
    accessKeyId: stringValue(oss.accessKeyId),
    accessKeySecret: stringValue(oss.accessKeySecret),
    endpoint: stringValue(oss.endpoint),
    bucketDomain: stringValue(oss.bucketDomain),
    forcePathStyle: oss.forcePathStyle
  }
}

// 获取项目文档专用 OSS 配置
const getProjectsOSSConfig = () => {
  const oss = getResolvedOSSRuntimeConfig()
  return {
    provider: stringValue(oss.provider),
    bucket: stringValue(oss.projectsBucketName),
    region: stringValue(oss.region),
    accessKeyId: stringValue(oss.accessKeyId),
    accessKeySecret: stringValue(oss.accessKeySecret),
    endpoint: stringValue(oss.projectsEndpoint),
    bucketDomain: stringValue(oss.projectsBucketDomain),
    forcePathStyle: oss.forcePathStyle
  }
}

// 获取图片专用 OSS 配置（公共读 bucket）
const getImagesOSSConfig = () => {
  const oss = getResolvedOSSRuntimeConfig()
  return {
    provider: stringValue(oss.provider),
    bucket: stringValue(oss.imagesBucketName),
    region: stringValue(oss.region),
    accessKeyId: stringValue(oss.accessKeyId),
    accessKeySecret: stringValue(oss.accessKeySecret),
    endpoint: stringValue(oss.imagesEndpoint),
    bucketDomain: stringValue(oss.imagesBucketDomain),
    forcePathStyle: oss.forcePathStyle
  }
}

// 创建 OSS 客户端
export const createOSSClient = (options: OSSClientOptions = {}): AliOssCompatibleClient => {
  const config = getOSSConfig()

  if (!config.accessKeyId || !config.accessKeySecret) {
    throw new Error('OSS credentials not configured')
  }

  return createAliOssCompatibleClient({
    ...config,
    ...options
  })
}

// 创建项目文档专用 OSS 客户端
export const createProjectsOSSClient = (options: OSSClientOptions = {}): AliOssCompatibleClient => {
  const config = getProjectsOSSConfig()

  if (!config.accessKeyId || !config.accessKeySecret) {
    throw new Error('Projects OSS credentials not configured')
  }

  return createAliOssCompatibleClient({
    ...config,
    ...options
  })
}

// 创建图片专用 OSS 客户端（公共读 bucket）
export const createImagesOSSClient = (options: OSSClientOptions = {}): AliOssCompatibleClient => {
  const config = getImagesOSSConfig()

  if (!config.accessKeyId || !config.accessKeySecret) {
    throw new Error('Images OSS credentials not configured')
  }

  return createAliOssCompatibleClient({
    ...config,
    ...options
  })
}

function isMissingCredentialsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('OSS credentials not configured')
    || message.includes('Projects OSS credentials not configured')
    || message.includes('Images OSS credentials not configured')
    || message.includes('Object storage bucket or endpoint is not configured')
    || message.includes('Object storage credentials are not configured')
}

async function createRuntimeBackedClient(factory: () => AliOssCompatibleClient) {
  try {
    return factory()
  } catch (error) {
    if (!isMissingCredentialsError(error)) {
      throw error
    }

    await loadCodocsOssRuntimeConfigFromConsole()
    return factory()
  }
}

export function createRuntimeOSSClient(options: OSSClientOptions = {}) {
  return createRuntimeBackedClient(() => createOSSClient(options))
}

export function createRuntimeProjectsOSSClient(options: OSSClientOptions = {}) {
  return createRuntimeBackedClient(() => createProjectsOSSClient(options))
}

export function createRuntimeImagesOSSClient(options: OSSClientOptions = {}) {
  return createRuntimeBackedClient(() => createImagesOSSClient(options))
}

function createDocumentClient(docType?: string, options: OSSClientOptions = {}) {
  const resolvedOptions = {
    timeout: DEFAULT_DOCUMENT_OSS_TIMEOUT_MS,
    ...options
  }
  return createRuntimeBackedClient(() => useProjectsBucket(docType)
    ? createProjectsOSSClient(resolvedOptions)
    : createOSSClient(resolvedOptions))
}

function createImageClient(options: OSSClientOptions = {}) {
  return createRuntimeBackedClient(() => createImagesOSSClient(options))
}

export const getImagesPublicUrl = (ossPath: string) => {
  const config = getImagesOSSConfig()
  const domain = config.bucketDomain
  return domain
    ? `https://${domain}/${ossPath}`
    : `https://${config.bucket}.${config.endpoint}/${ossPath}`
}

export const getImageContentTypeForPath = (ossPath: string) => {
  const ext = ossPath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'svg': return 'image/svg+xml'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'ico': return 'image/x-icon'
    case 'tif':
    case 'tiff': return 'image/tiff'
    case 'heic': return 'image/heic'
    case 'heif': return 'image/heif'
    case 'avif': return 'image/avif'
    default: return undefined
  }
}

export const getOSSRecycleDays = () => {
  const config = getResolvedOSSRuntimeConfig()
  return Number(config.recycleDays || 30)
}

// 判断是否使用项目文档 bucket
const useProjectsBucket = (docType?: string): boolean => {
  return docType === 'git-project'
}

/**
 * 获取文件元数据（包含冲突信息）
 * @param ossPath - OSS 文件路径
 * @param docType - 文档类型（可选）
 * @returns 文件元数据
 */
export const getFileMetadata = async (ossPath: string, docType?: string) => {
  const client = await createDocumentClient(docType)

  try {
    const result = await client.head(ossPath)
    const headers = result.res.headers as Record<string, string>
    return {
      size: headers['content-length'],
      meta: result.meta || {},
      lastModified: headers['last-modified']
    }
  } catch (error: unknown) {
    console.error(`Failed to get metadata for ${ossPath}:`, error)
    return null
  }
}

// 文档存储路径映射
const DOC_PATH_MAP: Record<string, string> = {
  private: 'users',
  slide: 'users',
  department: 'departments',
  project: 'projects',
  sale: 'sale',
  company: 'publish/company',
  knowledge: 'publish/knowledge',
  product: 'publish/products'
}

/**
 * 生成文档 OSS 存储路径
 * @param docType - 文档类型
 * @param ownerId - 所有者ID（用户名/部门ID/项目ID）
 * @param title - 文档标题（用作文件名）
 * @param folderPath - 文件夹路径（可选，用于在OSS上创建相同目录结构）
 */
export const getDocumentPath = (
  docType: string,
  ownerId: string,
  projectCode: string,
  deptCode: string,
  title: string,
  folderPath?: string
): string => {
  const basePath = DOC_PATH_MAP[docType] || 'docs'

  // 清理标题，移除特殊字符
  const sanitizedTitle = title
    .replace(/[\\/:*?"<>|]/g, '_') // 替换非法文件名字符
    .replace(/\s+/g, '_') // 空格替换为下划线
    .slice(0, 100) // 限制长度

  const filename = `${sanitizedTitle}.md`

  // 构建文件夹路径部分（如果有）
  const folderPart = folderPath ? `/${folderPath}` : ''

  if (docType === 'private') {
    return `codocs/${basePath}/${ownerId}/docs${folderPart}/${filename}`
  }

  if (docType === 'slide') {
    return `codocs/${basePath}/${ownerId}/slides${folderPart}/${filename}`
  }

  if (docType === 'department') {
    return `codocs/${basePath}/${deptCode}/docs${folderPart}/${filename}`
  }

  if (docType === 'project') {
    return `codocs/${basePath}/${projectCode}/docs${folderPart}/${filename}`
  }

  if (docType === 'sale') {
    // 销售文档按 project_code（实体编码如 OP-20260300001）分组
    return `codocs/${basePath}/${projectCode}/docs${folderPart}/${filename}`
  }

  return `codocs/${basePath}${folderPart}/${filename}`
}

/**
 * 上传文档到 OSS
 * 保持文件元数据不变（如 gitlab-commit-id, conflict-status 等）
 */
export const uploadDocument = async (
  path: string,
  content: string,
  docType?: string
): Promise<{ url: string, versionId?: string }> => {
  const client = await createDocumentClient(docType)
  console.log('uploadDocument', path, docType)
  // 1. 读取现有文件的元数据
  const existingMeta: Record<string, string> = {}
  try {
    const headResult = await client.head(path)
    // Convert meta values to strings (ali-oss UserMeta allows string | number)
    if (headResult.meta) {
      for (const [key, value] of Object.entries(headResult.meta)) {
        existingMeta[key] = String(value)
      }
    }
  } catch (error: unknown) {
    // 文件不存在时，忽略错误（新建文档）
    if ((error as OSSError).code !== 'NoSuchKey') {
      console.warn(`Failed to read metadata for ${path}:`, error)
    }
  }

  // 2. 上传文件，保留原有元数据
  const result = await client.put(path, Buffer.from(content, 'utf-8'), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8'
    },
    meta: existingMeta as OSSUserMeta
  })

  return {
    url: result.url || path,
    versionId: (result.res.headers as Record<string, string>)['x-oss-version-id']
  }
}

/**
 * 从 OSS 下载文档
 * @param path - OSS 文件路径
 * @param docType - 文档类型（可选）
 */
export const downloadDocument = async (path: string, docType?: string): Promise<string | null> => {
  const client = await createDocumentClient(docType)
  console.log('downloadDocument', path, docType)
  try {
    const result = await client.get(path)
    // console.log("result", result)
    return result.content.toString('utf-8')
  } catch (error: unknown) {
    if ((error as OSSError).code === 'NoSuchKey') {
      return null
    }
    throw error
  }
}

export const downloadDocumentBuffer = async (path: string, docType?: string): Promise<Buffer | null> => {
  const client = await createDocumentClient(docType)
  try {
    const result = await client.get(path)
    return Buffer.isBuffer(result.content)
      ? result.content
      : Buffer.from(result.content)
  } catch (error: unknown) {
    if ((error as OSSError).code === 'NoSuchKey') {
      return null
    }
    throw error
  }
}

const getYjsSnapshotPath = (ossPath: string): string => {
  return ossPath.endsWith('.md') ? ossPath.replace(/\.md$/, '.yjs') : `${ossPath}.yjs`
}

/**
 * 删除 OSS 文档
 * @param path - OSS 文件路径
 * @param docType - 文档类型（可选）
 */
export const deleteDocument = async (path: string, docType?: string): Promise<void> => {
  const client = await createDocumentClient(docType)
  await client.delete(path)
}

/**
 * 重命名 OSS 文档（复制到新路径后删除旧文件）
 * @param oldPath - 旧文件路径
 * @param newPath - 新文件路径
 * @param docType - 文档类型（可选）
 */
export const renameDocument = async (oldPath: string, newPath: string, docType?: string): Promise<void> => {
  if (oldPath === newPath) return

  const client = await createDocumentClient(docType)
  const moveObject = async (sourcePath: string, targetPath: string, required: boolean) => {
    try {
      await client.copy(targetPath, sourcePath)
      await client.delete(sourcePath)
      return true
    } catch (error: unknown) {
      if ((error as OSSError).code === 'NoSuchKey') {
        if (required) {
          console.warn(`OSS rename: source file not found: ${sourcePath}`)
        }
        return false
      }
      throw error
    }
  }

  // OSS 没有原生的重命名操作，需要先复制再删除。
  // 协同文档同时维护 .md 预览快照和 .yjs CRDT 快照，移动路径时二者必须保持一致。
  const movedMarkdown = await moveObject(oldPath, newPath, true)
  const oldYjsPath = getYjsSnapshotPath(oldPath)
  const newYjsPath = getYjsSnapshotPath(newPath)
  const movedSnapshot = oldYjsPath === oldPath || oldYjsPath === newYjsPath
    ? false
    : await moveObject(oldYjsPath, newYjsPath, false)

  if (!movedMarkdown && !movedSnapshot) {
    console.warn(`OSS rename: neither markdown nor yjs snapshot found for ${oldPath}`)
  }
}

/**
 * 重命名 OSS 文件夹（移动该前缀下的所有文件）
 * @param docType 文档类型
 * @param ownerId 所有者ID
 * @param oldFolderPath 旧文件夹路径
 * @param newFolderPath 新文件夹路径
 */
export const renameFolderInOSS = async (
  docType: string,
  ownerId: string,
  oldFolderPath: string,
  newFolderPath: string
): Promise<void> => {
  if (oldFolderPath === newFolderPath) return

  const client = await createRuntimeOSSClient()
  const basePath = DOC_PATH_MAP[docType] || 'docs'
  let prefixBase = ''

  if (docType === 'private' || docType === 'department' || docType === 'project' || docType === 'sale') {
    prefixBase = `codocs/${basePath}/${ownerId}/docs`
  } else if (docType === 'slide') {
    prefixBase = `codocs/${basePath}/${ownerId}/slides`
  } else {
    prefixBase = `codocs/${basePath}`
  }

  const oldPrefix = `${prefixBase}/${oldFolderPath}/`
  const newPrefix = `${prefixBase}/${newFolderPath}/`

  let continuationToken: string | null = null

  do {
    // 列出所有文件
    const result = await (client as unknown as { listV2: (params: Record<string, unknown>) => Promise<OSSListV2Result> }).listV2({
      'prefix': oldPrefix,
      'continuation-token': continuationToken,
      'max-keys': 100 // 每次处理100个
    })

    if (result.objects && result.objects.length > 0) {
      // 并行处理复制和删除（建议分批处理以避免超时或限流）
      await Promise.all(result.objects.map(async (obj) => {
        const oldKey = obj.name
        const newKey = oldKey.replace(oldPrefix, newPrefix)

        try {
          await client.copy(newKey, oldKey)
          await client.delete(oldKey)
        } catch (err) {
          console.error(`Failed to move OSS object from ${oldKey} to ${newKey}:`, err)
        }
      }))
    }

    if (result.isTruncated) {
      continuationToken = result.nextContinuationToken ?? null
    } else {
      continuationToken = null
    }
  } while (continuationToken)
}

/**
 * 上传图片到 OSS（公共读 bucket）
 * 图片存储在独立的公共读 bucket 中，返回永久公开 URL
 * @param buffer - 图片内容
 * @param filename - 原始文件名（用于提取后缀）
 * @param ownerId - 用户名（用于构建路径）
 * @param meta - 可选元数据（如 doc-path 关联文档路径）
 */
export const uploadImage = async (
  buffer: Buffer,
  filename: string,
  ownerId: string,
  meta?: Record<string, string>
): Promise<string> => {
  const client = await createRuntimeImagesOSSClient()
  const config = getImagesOSSConfig()

  // Extract extension and generate UUID filename
  const ext = filename.split('.').pop()?.toLowerCase() || 'png'
  const uniqueName = `${uuidv4()}.${ext}`

  // Path: codocs/users/{uid}/images/{uuid}.{ext}
  const path = `codocs/users/${ownerId}/images/${uniqueName}`

  const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`

  console.log('[uploadImage] path:', path, 'meta:', meta)
  await client.put(path, buffer, {
    headers: {
      'Content-Type': mimeType
    },
    meta: meta as OSSUserMeta
  })

  // 公共读 bucket，直接返回永久公开 URL
  if (config.bucketDomain) {
    return `https://${config.bucketDomain}/${path}`
  }

  // 降级：使用 OSS 默认域名
  return `https://${config.bucket}.${config.endpoint}/${path}`
}

/**
 * 列出图片 bucket 中所有图片文件（带元数据）
 * @param prefix - 路径前缀，默认 codocs/users/
 */
export const listImages = async (prefix: string = 'codocs/users/'): Promise<{
  name: string
  path: string
  size: number
  lastModified: string
  url: string
}[]> => {
  const client = await createImageClient()
  const images: { name: string, path: string, size: number, lastModified: string, url: string }[] = []
  let continuationToken: string | undefined

  do {
    const result = await (client as unknown as { listV2: (params: Record<string, unknown>) => Promise<OSSListV2Result> }).listV2({
      'prefix': prefix,
      'continuation-token': continuationToken,
      'max-keys': 1000
    })

    if (result.objects && result.objects.length > 0) {
      for (const obj of result.objects) {
        // 只处理图片文件
        if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|pic|tiff|tif|heic|heif|avif)$/i.test(obj.name)) {
          images.push({
            name: obj.name.split('/').pop() || obj.name,
            path: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
            url: getImagesPublicUrl(obj.name)
          })
        }
      }
    }

    continuationToken = result.isTruncated ? result.nextContinuationToken : undefined
  } while (continuationToken)

  return images
}

/**
 * 获取图片文件的元数据
 * @param ossPath - 图片 OSS 路径
 */
export const getImageMetadata = async (ossPath: string): Promise<Record<string, string>> => {
  const client = await createImageClient()
  try {
    const result = await client.head(ossPath)
    return (result.meta || {}) as Record<string, string>
  } catch {
    return {}
  }
}

export const downloadImageBuffer = async (ossPath: string): Promise<Buffer | null> => {
  const client = await createImageClient()
  try {
    const result = await client.get(ossPath)
    return Buffer.isBuffer(result.content)
      ? result.content
      : Buffer.from(result.content)
  } catch (error: unknown) {
    if ((error as OSSError).code === 'NoSuchKey') {
      return null
    }
    throw error
  }
}

/**
 * 删除图片文件
 * @param ossPath - 图片 OSS 路径
 */
export const deleteImage = async (ossPath: string): Promise<void> => {
  const client = await createImageClient()
  await client.delete(ossPath)
}

/**
 * 批量删除图片文件
 * @param ossPaths - 图片 OSS 路径列表
 */
export const deleteImages = async (ossPaths: string[]): Promise<void> => {
  if (ossPaths.length === 0) return
  const client = await createImageClient()
  await client.deleteMulti(ossPaths)
}

/**
 * 生成 OSS 签名 URL（用于私有 bucket）
 */
export const getSignedUrl = async (path: string, expires: number = 3600, response?: Record<string, string>): Promise<string> => {
  const client = await createRuntimeOSSClient()
  const url = client.createSignedGetUrl
    ? await client.createSignedGetUrl(path, { expires, response })
    : client.signatureUrl(path, { expires, response })
  return url.replace(/^http:\/\//, 'https://')
}

/**
 * 列出 OSS 文件和目录（递归）
 * @param prefix - OSS 路径前缀
 * @param recursive - 是否递归获取子目录，默认 true
 */
export interface OSSFileItem {
  name: string
  path: string
  size: number
  lastModified: string
  isDirectory: boolean
  children?: OSSFileItem[]
}

export const listFiles = async (
  prefix: string,
  recursive: boolean = true,
  docType?: string
): Promise<OSSFileItem[]> => {
  const client = await createDocumentClient(docType)

  // 确保 prefix 以 / 结尾
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`

  console.log('normalizedPrefix', normalizedPrefix)

  const files: OSSFileItem[] = []
  const directories = new Map<string, OSSFileItem>()

  let continuationToken: string | undefined

  do {
    const result = await (client as unknown as { listV2: (params: Record<string, unknown>) => Promise<OSSListV2Result> }).listV2({
      'prefix': normalizedPrefix,
      'continuation-token': continuationToken,
      'max-keys': 1000
    })

    if (result.objects && result.objects.length > 0) {
      for (const obj of result.objects) {
        const relativePath = obj.name.substring(normalizedPrefix.length)

        // 跳过空文件名
        if (!relativePath) continue

        const pathParts = relativePath.split('/')
        const fileName = pathParts[pathParts.length - 1]

        // 处理文件
        if (pathParts.length === 1 && fileName) {
          files.push({
            name: fileName,
            path: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
            isDirectory: false
          })
        } else if (recursive && pathParts.length > 1) {
          // 处理目录
          const dirName = pathParts[0]!
          if (!directories.has(dirName)) {
            directories.set(dirName, {
              name: dirName,
              path: `${normalizedPrefix}${dirName}/`,
              size: 0,
              lastModified: obj.lastModified,
              isDirectory: true,
              children: []
            })
          }
        }
      }
    }

    continuationToken = result.isTruncated ? result.nextContinuationToken : undefined
  } while (continuationToken)

  // 递归获取子目录内容
  if (recursive) {
    for (const [_dirName, dirItem] of directories) {
      dirItem.children = await listFiles(dirItem.path, true, docType)
    }
  }

  // 合并文件和目录
  return [...Array.from(directories.values()), ...files]
}

/**
 * 将文档移动到 OSS 回收站
 * 回收站路径: 将 codocs/ 前缀替换为 recycle.bin/
 * @param ossPath - 当前 OSS 路径
 * @param docType - 文档类型
 */
export const moveToRecycleBin = async (ossPath: string, docType?: string): Promise<void> => {
  if (!ossPath) return
  const recyclePath = ossPath.replace(/^codocs\//, 'recycle.bin/')
  if (recyclePath === ossPath) return // 无法转换路径，跳过

  const client = await createDocumentClient(docType)
  try {
    await client.copy(recyclePath, ossPath)
    await client.delete(ossPath)
  } catch (error: unknown) {
    if ((error as OSSError).code === 'NoSuchKey') {
      console.warn(`moveToRecycleBin: source file not found: ${ossPath}`)
      return
    }
    throw error
  }

  // 删除对应的 .yjs 协作状态文件（不需要移到回收站）
  const yjsPath = getYjsSnapshotPath(ossPath)
  if (yjsPath !== ossPath) {
    try {
      await client.delete(yjsPath)
    } catch (error: unknown) {
      if ((error as OSSError).code !== 'NoSuchKey') {
        console.warn(`moveToRecycleBin: failed to delete yjs file: ${yjsPath}`, error)
      }
    }
  }
}

/**
 * 从 OSS 回收站恢复文档
 * @param ossPath - 原始 OSS 路径 (codocs/...)
 * @param docType - 文档类型
 */
export const restoreFromRecycleBin = async (ossPath: string, docType?: string): Promise<void> => {
  if (!ossPath) return
  const recyclePath = ossPath.replace(/^codocs\//, 'recycle.bin/')
  if (recyclePath === ossPath) return

  const client = await createDocumentClient(docType)
  try {
    await client.copy(ossPath, recyclePath)
    await client.delete(recyclePath)
  } catch (error: unknown) {
    if ((error as OSSError).code === 'NoSuchKey') {
      console.warn(`restoreFromRecycleBin: recycle file not found: ${recyclePath}`)
      return
    }
    throw error
  }
}

/**
 * 在 OSS 上将文档移动到新路径（用于重命名恢复）
 * @param oldOssPath - 回收站中的路径
 * @param newOssPath - 新的目标路径
 * @param docType - 文档类型
 */
export const moveOSSFile = async (oldOssPath: string, newOssPath: string, docType?: string): Promise<void> => {
  if (!oldOssPath || !newOssPath || oldOssPath === newOssPath) return

  const client = await createDocumentClient(docType)
  try {
    await client.copy(newOssPath, oldOssPath)
    await client.delete(oldOssPath)
  } catch (error: unknown) {
    if ((error as OSSError).code === 'NoSuchKey') {
      console.warn(`moveOSSFile: source file not found: ${oldOssPath}`)
      return
    }
    throw error
  }
}
