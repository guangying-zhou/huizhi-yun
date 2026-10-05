// Project name rule. The Runtime project update command is the source of truth
// (data-runtime/internal/apps/aims/enterprise_project_update.go:
// `^[\p{Han}a-zA-Z0-9]+(?:[vV]\d+)?$`, at most 200 characters). Create and edit
// share this copy so a name the Host accepts at creation can be edited later.
export const projectNamePattern = /^[\p{Script=Han}a-zA-Z0-9]+(?:[vV]\d+)?$/u
export const projectNameMaxLength = 200
export const projectNameRuleMessage = '项目名称只能包含汉字、英文和数字，不允许空格、连字符等特殊字符，可选尾部版本号如 V2'

/** Empty string when valid; otherwise the message to show next to the field. */
export function projectNameError(value: unknown): string {
  const name = typeof value === 'string' ? value : ''
  if (!name.trim()) return '请填写项目名称'
  if ([...name].length > projectNameMaxLength) return `项目名称不能超过 ${projectNameMaxLength} 个字符`
  return projectNamePattern.test(name) ? '' : projectNameRuleMessage
}
