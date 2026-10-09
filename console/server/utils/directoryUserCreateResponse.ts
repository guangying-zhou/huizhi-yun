function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function publicFields(value: unknown, fields: readonly string[]) {
  const input = record(value)
  const output: Record<string, string | number | boolean | null> = {}
  for (const key of fields) {
    const field = input[key]
    if (field === null || typeof field === 'string' || typeof field === 'boolean' || (typeof field === 'number' && Number.isFinite(field))) output[key] = field
  }
  return output
}

export function ldapUserCreateResponse(operation: unknown, activationDelivered = false) {
  const envelope = record(operation)
  const data = record(envelope.data)
  const safeData = publicFields(data, ['operationId', 'operationCode', 'status', 'uid', 'initialPasswordGenerated', 'activationExpiresAt'])
  // 初始密码的既有一次性返回合同保留；激活模式（含不完整凭据）绝不回传。
  if (!data.activationToken && !data.activationCredentialId && !data.activationExpiresAt && data.initialPasswordGenerated === true && typeof data.initialPassword === 'string') {
    safeData.initialPassword = data.initialPassword
  }
  return {
    code: 0,
    data: { ...safeData, activationDelivered },
    ...(typeof envelope.replayed === 'boolean' ? { replayed: envelope.replayed } : {})
  }
}

export function directoryUserCreateResponse(user: unknown) {
  if (user === null) return null
  return publicFields(user, [
    'id', 'uid', 'username', 'displayName', 'realName', 'nickname', 'email', 'mobile', 'mobileTail4',
    'avatar', 'gender', 'status', 'deptCode', 'deptName', 'positionTitle', 'userType', 'dingtalkId'
  ])
}
