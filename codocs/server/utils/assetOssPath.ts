import { createError } from 'h3'

function textValue(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

function hasControlCharacter(value: string) {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function normalizeRelativeOssPath(value: unknown, options: { allowEmpty?: boolean, message?: string } = {}) {
  const rawPath = textValue(value).replace(/^\/+|\/+$/g, '')
  if (!rawPath) {
    if (options.allowEmpty) return ''
    throw createError({ statusCode: 400, message: options.message || '无效的文件路径' })
  }
  if (rawPath.length > 800 || rawPath.includes('\\') || hasControlCharacter(rawPath)) {
    throw createError({ statusCode: 400, message: options.message || '无效的文件路径' })
  }

  const segments = rawPath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw createError({ statusCode: 400, message: options.message || '无效的文件路径' })
  }

  return segments.join('/')
}

function assertSingleSegment(value: string, message: string) {
  if (!value || value.includes('/')) {
    throw createError({ statusCode: 400, message })
  }
  return value
}

export function normalizeCompanyAssetOssPath(value: unknown) {
  const path = normalizeRelativeOssPath(value)
  if (!path.startsWith('codocs/company/') || path === 'codocs/company') {
    throw createError({ statusCode: 400, message: '无效的文件路径' })
  }
  return path
}

export function normalizeDepartmentAssetOssPath(value: unknown) {
  const path = normalizeRelativeOssPath(value)
  if (!path.startsWith('codocs/departments/')) {
    throw createError({ statusCode: 400, message: '无效的文件路径' })
  }
  const segments = path.split('/')
  if (segments.length < 4 || !segments[2] || !segments[3]) {
    throw createError({ statusCode: 400, message: '无效的文件路径' })
  }
  return path
}

export function normalizeDepartmentOutsideAssetOssPath(value: unknown) {
  const path = normalizeDepartmentAssetOssPath(value)
  const segments = path.split('/')
  if (segments.length < 5 || segments[3] !== 'outsides') {
    throw createError({ statusCode: 400, message: '仅对外发文支持 DOCX 导出' })
  }
  return path
}

export function buildCompanyAssetPrefix(subdir: unknown, subPath: unknown) {
  const root = normalizeRelativeOssPath(subdir, { message: '缺少 subdir 参数' })
  const child = normalizeRelativeOssPath(subPath, { allowEmpty: true })
  const relative = child ? `${root}/${child}` : root
  return `codocs/company/${relative}/`
}

export function buildDepartmentAssetPrefix(deptCode: unknown, subdir: unknown, subPath: unknown) {
  const dept = assertSingleSegment(normalizeRelativeOssPath(deptCode, { message: '缺少 deptCode 或 subdir 参数' }), '无效的部门编码')
  const root = normalizeRelativeOssPath(subdir, { message: '缺少 deptCode 或 subdir 参数' })
  const child = normalizeRelativeOssPath(subPath, { allowEmpty: true })
  const relative = child ? `${root}/${child}` : root
  return `codocs/departments/${dept}/${relative}/`
}
