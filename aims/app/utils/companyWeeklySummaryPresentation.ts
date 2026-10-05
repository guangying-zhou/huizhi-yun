// 公司项目周报汇总面板的展示逻辑（纯函数，便于单测）。
import { formatDateTime } from '../../../foundation/app/utils/format'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 版本时间：优先发布时间，否则创建时间；按浏览器本地时区格式化，无效值显示为“-”。 */
export function summaryVersionTimeLabel(version: { publishedAt?: string | null, createdAt?: string | null }): string {
  return formatDateTime(version.publishedAt || version.createdAt, { hour12: false })
}

/**
 * 已存档 Codocs 文档的入口。仅企业宿主内 Codocs 与 Aims 同源，路由为
 * `/codocs/documents/<uuid>`；独立部署没有同源 Codocs 路由，且 uuid 缺失或
 * 非法时都不展示入口。
 */
export function codocsDocumentHref(uuid: string | null | undefined, hosted: boolean): string | null {
  if (!hosted || !uuid || !uuidPattern.test(uuid)) return null
  return `/codocs/documents/${uuid}`
}
