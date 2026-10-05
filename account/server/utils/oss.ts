import OSS from 'ali-oss'

interface OSSConfig {
  bucket: string
  endpoint: string
  accessKeyId: string
  accessKeySecret: string
  region?: string
}

let ossClient: OSS | null = null
let projectsOSSClient: OSS | null = null

function getOSSConfig(): OSSConfig {
  return {
    bucket: process.env.ALIYUN_OSS_BUCKET_NAME || '',
    endpoint: process.env.ALIYUN_OSS_ENDPOINT || '',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    region: process.env.ALIYUN_OSS_REGION || ''
  }
}

function getProjectsOSSConfig(): OSSConfig {
  return {
    bucket: process.env.ALIYUN_OSS_PROJECTS_BUCKET_NAME || '',
    endpoint: process.env.ALIYUN_OSS_PROJECTS_ENDPOINT || '',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    region: process.env.ALIYUN_OSS_REGION || ''
  }
}

export function useOSS(): OSS {
  if (!ossClient) {
    const config = getOSSConfig()

    console.log('[OSS] Config:', { bucket: config.bucket, endpoint: config.endpoint, region: config.region })

    if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.accessKeySecret) {
      throw new Error('OSS configuration is incomplete')
    }

    ossClient = new OSS({
      bucket: config.bucket,
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      region: config.region
    })
  }

  return ossClient
}

/**
 * Get OSS client for project documents
 * Projects bucket does not have versioning enabled
 */
export function useProjectsOSS(): OSS {
  if (!projectsOSSClient) {
    const config = getProjectsOSSConfig()

    console.log('[Projects OSS] Config:', { bucket: config.bucket, endpoint: config.endpoint, region: config.region })

    if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.accessKeySecret) {
      throw new Error('Projects OSS configuration is incomplete')
    }

    projectsOSSClient = new OSS({
      bucket: config.bucket,
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      region: config.region
    })
  }

  return projectsOSSClient
}

/**
 * Upload a file to OSS
 * @param path OSS path (e.g., 'avatars/user123.jpg')
 * @param data File buffer
 * @param contentType MIME type
 * @returns The OSS path of the uploaded file (not a public URL)
 */
export async function uploadToOSS(path: string, data: Buffer, contentType: string): Promise<string> {
  const client = useOSS()

  await client.put(path, data, {
    headers: {
      'Content-Type': contentType
    }
  })

  // Return the path (will be used to generate signed URL or proxy)
  return path
}

/**
 * Generate a signed URL for accessing a private file
 * @param path OSS path
 * @param expires Expiration time in seconds (default 1 hour)
 * @returns Signed URL
 */
export function getSignedUrl(path: string, expires: number = 3600): string {
  const client = useOSS()
  return client.signatureUrl(path, { expires })
}

/**
 * Get file from OSS as buffer
 * @param path OSS path
 * @returns File buffer and content type
 */
export async function getFromOSS(path: string): Promise<{ content: Buffer, contentType: string }> {
  const client = useOSS()
  const result = await client.get(path)
  const headers = result.res.headers as Record<string, string>
  return {
    content: result.content as Buffer,
    contentType: headers['content-type'] || 'application/octet-stream'
  }
}

/**
 * Delete a file from OSS
 * @param path OSS path
 */
export async function deleteFromOSS(path: string): Promise<void> {
  const client = useOSS()
  await client.delete(path)
}

/**
 * Generate avatar path for a user
 * @param ldapUid User's LDAP UID
 * @param ext File extension (e.g., 'jpg', 'png')
 */
export function getAvatarPath(ldapUid: string, ext: string): string {
  const timestamp = Date.now()
  return `${ldapUid}_${timestamp}.${ext}`
}
