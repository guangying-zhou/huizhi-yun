import type { H3Event } from 'h3'
import { createRuntimeOSSClient } from './oss'
import { decodeTextPreviewBuffer } from './textPreviewEncoding'

export const CABINET_TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt',
  'csv',
  'json',
  'xml',
  'html',
  'css',
  'js',
  'ts',
  'java',
  'py',
  'go',
  'rs',
  'c',
  'cpp',
  'h',
  'sql',
  'sh',
  'yaml',
  'yml'
])

const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

export async function readCabinetTextPreview(event: H3Event, ossPath: string) {
  const client = await createRuntimeOSSClient({ event, timeout: 300000 })
  const result = await client.get(ossPath)
  const contentBuffer = Buffer.isBuffer(result.content)
    ? result.content
    : Buffer.from(result.content)
  const truncated = contentBuffer.byteLength > TEXT_PREVIEW_MAX_BYTES
  const previewBuffer = truncated
    ? contentBuffer.subarray(0, TEXT_PREVIEW_MAX_BYTES)
    : contentBuffer

  return {
    ...decodeTextPreviewBuffer(previewBuffer),
    truncated
  }
}
