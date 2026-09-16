import { hasProductControlCharacter } from './productWorkspaceInput.ts'

/** 产品线编码、产品编码与 UID 共用同一套标识字符约束。 */
export function productIdentifier(value: unknown): value is string {
  return typeof value === 'string' && !!value && value === value.trim() && [...value].length <= 64 && !value.includes('/') && !value.includes(',') && !hasProductControlCharacter(value)
}
export const productLineCode = productIdentifier
export function productLineOnboardInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(k => !['productLine', 'managerUid', 'productCodes', 'expectedWatermark'].includes(k)) || !productIdentifier(v.productLine) || !productIdentifier(v.managerUid) || typeof v.expectedWatermark !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9]\d*$/.test(v.expectedWatermark)) return null
  // 浏览器只能选择纳入哪些产品；产品是否属于该产品线、是否可接入由目录证据判定。
  if (!Array.isArray(v.productCodes) || !v.productCodes.length || v.productCodes.length > 1000 || v.productCodes.some(code => !productIdentifier(code)) || new Set(v.productCodes as string[]).size !== v.productCodes.length) return null
  return { line_code: v.productLine, manager_uid: v.managerUid, product_codes: v.productCodes as string[], expected_watermark: v.expectedWatermark }
}
