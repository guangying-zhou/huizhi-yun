export interface PeopleDirectoryEmploymentProjection {
  employeeUid: string
  loginName?: string
  displayName?: string
  realName?: string
  deptCode?: string
  positionCode?: string
  positionName?: string
  employmentStatus?: string
  operatorUid?: string
  reason: string
}

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH'])
const offboardingStatuses = new Set(['left', 'inactive'])

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function requestOperatorUid(body: Record<string, unknown>) {
  return text(body.current_user || body.currentUser || body.operator_uid || body.operatorUid)
}

function pickString(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

function hasAnyProjectionField(body: Record<string, unknown>) {
  return [
    'login_name',
    'loginName',
    'display_name',
    'displayName',
    'real_name',
    'realName',
    'dept_code',
    'deptCode',
    'position_code',
    'positionCode',
    'position_name',
    'positionName',
    'employment_status',
    'employmentStatus',
    'status'
  ].some(key => key in body)
}

function employmentStatus(body: Record<string, unknown>) {
  return pickString(body, 'employment_status', 'employmentStatus', 'status').toLowerCase()
}

function fromBody(
  employeeUid: string,
  body: Record<string, unknown>,
  reason: string,
  defaultEmploymentStatus = ''
): PeopleDirectoryEmploymentProjection | null {
  if (!employeeUid || !hasAnyProjectionField(body)) return null

  const status = employmentStatus(body) || defaultEmploymentStatus
  if (offboardingStatuses.has(status)) return null

  return {
    employeeUid,
    loginName: pickString(body, 'login_name', 'loginName'),
    displayName: pickString(body, 'display_name', 'displayName'),
    realName: pickString(body, 'real_name', 'realName', 'display_name', 'displayName'),
    deptCode: pickString(body, 'dept_code', 'deptCode'),
    positionCode: pickString(body, 'position_code', 'positionCode'),
    positionName: pickString(body, 'position_name', 'positionName'),
    employmentStatus: status,
    operatorUid: requestOperatorUid(body),
    reason
  }
}

export function resolvePeopleDirectoryEmploymentProjection(
  suffix: string,
  method: string,
  rawBody: unknown
): PeopleDirectoryEmploymentProjection | null {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  if (!mutatingMethods.has(normalizedMethod)) return null

  const body = objectBody(rawBody)
  const employeeMatch = /^\/employees\/([^/]+)\/?$/.exec(suffix)
  if (employeeMatch) {
    return fromBody(
      safeDecode(employeeMatch[1] || ''),
      body,
      'people_employee_fact_projection'
    )
  }

  if (/^\/employees\/?$/.test(suffix)) {
    return fromBody(
      pickString(body, 'employee_uid', 'employeeUid', 'uid'),
      body,
      'people_employee_fact_projection',
      'active'
    )
  }

  if (/^\/assignments\/?$/.test(suffix)) {
    const changeType = pickString(body, 'change_type', 'changeType').toLowerCase()
    if (!changeType || changeType === 'leave') return null
    if (!['dept_code', 'deptCode', 'position_code', 'positionCode', 'position_name', 'positionName'].some(key => key in body)) return null

    return fromBody(
      pickString(body, 'employee_uid', 'employeeUid'),
      {
        ...body,
        employment_status: 'active'
      },
      'people_assignment_membership_projection',
      'active'
    )
  }

  return null
}
