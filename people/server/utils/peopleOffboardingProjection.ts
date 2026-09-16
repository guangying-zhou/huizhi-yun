export interface PeopleOffboardingProjection {
  employeeUid: string
  operatorUid?: string
  leaveDate?: string
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

function normalizedStatus(value: unknown) {
  return text(value).toLowerCase()
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

export function resolvePeopleOffboardingProjection(
  suffix: string,
  method: string,
  rawBody: unknown
): PeopleOffboardingProjection | null {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  if (!mutatingMethods.has(normalizedMethod)) return null

  const body = objectBody(rawBody)
  const employeeMatch = /^\/employees\/([^/]+)\/?$/.exec(suffix)
  if (employeeMatch) {
    const status = normalizedStatus(body.employment_status || body.employmentStatus || body.status)
    if (!offboardingStatuses.has(status)) return null

    const employeeUid = safeDecode(employeeMatch[1] || '')
    if (!employeeUid) return null

    return {
      employeeUid,
      operatorUid: requestOperatorUid(body),
      leaveDate: text(body.leave_date || body.leaveDate),
      reason: 'people_employee_status_offboarding'
    }
  }

  if (/^\/assignments\/?$/.test(suffix)) {
    const changeType = normalizedStatus(body.change_type || body.changeType)
    if (changeType !== 'leave') return null

    const employeeUid = text(body.employee_uid || body.employeeUid)
    if (!employeeUid) return null

    return {
      employeeUid,
      operatorUid: requestOperatorUid(body),
      leaveDate: text(body.effective_from || body.effectiveFrom || body.leave_date || body.leaveDate),
      reason: 'people_assignment_leave_offboarding'
    }
  }

  return null
}
