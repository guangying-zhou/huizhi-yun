/**
 * 项目简称校验（零依赖，便于单元测试直接加载）。
 *
 * short_name 是 data-runtime 的必填字段，缺失会返回
 * 400 missing_required_fields。所有创建入口都必须在提交前调用本函数。
 */
export function validateProjectShortName(shortName: string | undefined | null): string {
  const value = (shortName || '').trim()
  if (!value) return '请填写项目简称'
  const chineseCharCount = (value.match(/[一-龥]/g) || []).length
  if (chineseCharCount > 6) return '项目简称不能超过6个汉字'
  return ''
}
