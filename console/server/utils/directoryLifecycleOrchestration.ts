export type DirectoryLifecyclePhase
  = 'employment_authorization_sync'
    | 'offboarding_authorization_reclaim'

export interface DirectoryLifecycleFailureNotificationInput {
  uid: string
  operatorUid: string
  idempotencyKey: string
  phase: DirectoryLifecyclePhase
  message: string
  sourceApp: string
}

export type PlatformLifecycleAttempt<TResult = unknown, TNotification = unknown>
  = { ok: true, result: TResult }
    | { ok: false, error: string, notification: TNotification }

export interface DirectoryLifecycleOperationLog {
  action: 'directory.user.employment.from_people' | 'directory.user.disable.from_people'
  uid: string
  actorId: string | null
  idempotencyKey: string
  detail: Record<string, unknown>
}

export interface EmploymentLifecycleInput {
  uid: string
  sourceApp: string
  actorId: string | null
  operatorUid: string
  reason: string
  idempotencyKey: string
  created: boolean
  primaryDeptCode: string | null
  positionCode: string | null
  positionName: string | null
  employmentStatus: string | null
}

export interface EmploymentLifecycleDependencies<TUser, TPlatformResult, TNotification> {
  applyDirectoryProjection: () => Promise<void>
  syncPlatformAuthorization: (input: {
    uid: string
    sourceApp: string
    positionCode: string
    positionName: string
    deptCode: string
    operatorUid: string
    reason: string
    idempotencyKey: string
  }) => Promise<TPlatformResult>
  notifyFailure: (input: DirectoryLifecycleFailureNotificationInput) => Promise<TNotification>
  writeOperationLog: (input: DirectoryLifecycleOperationLog) => Promise<void>
  loadDirectoryUser: (uid: string) => Promise<TUser | null>
  warn?: (message: string, context: Record<string, unknown>) => void
}

export interface OffboardingLifecycleInput {
  uid: string
  sourceApp: string
  actorId: string | null
  operatorUid: string
  reason: string
  leaveDate: string
  idempotencyKey: string
  existingStatus: unknown
}

export interface RevokedDirectorySessions {
  refreshTokens: number
  sessions: number
}

export interface OffboardingLifecycleDependencies<TUser, TPlatformResult, TNotification> {
  deactivateDirectoryUser: (uid: string) => Promise<void>
  revokeUserSessions: (uid: string) => Promise<RevokedDirectorySessions>
  reclaimPlatformAuthorization: (input: {
    uid: string
    sourceApp: string
    operatorUid: string
    reason: string
    idempotencyKey: string
  }) => Promise<TPlatformResult>
  notifyFailure: (input: DirectoryLifecycleFailureNotificationInput) => Promise<TNotification>
  writeOperationLog: (input: DirectoryLifecycleOperationLog) => Promise<void>
  loadDirectoryUser: (uid: string) => Promise<TUser | null>
  warn?: (message: string, context: Record<string, unknown>) => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'unknown error')
}

export function directoryLifecycleStatus(value: unknown) {
  if (value === 1 || value === '1' || value === 'active') return 'active'
  if (value === -1 || value === '-1' || value === 'deleted') return 'deleted'
  return 'inactive'
}

function warn(
  callback: ((message: string, context: Record<string, unknown>) => void) | undefined,
  message: string,
  context: Record<string, unknown>
) {
  if (callback) {
    callback(message, context)
    return
  }
  console.warn(message, context)
}

export async function orchestrateEmploymentLifecycle<TUser, TPlatformResult, TNotification>(
  input: EmploymentLifecycleInput,
  dependencies: EmploymentLifecycleDependencies<TUser, TPlatformResult, TNotification>
) {
  await dependencies.applyDirectoryProjection()

  let authorizationSync: PlatformLifecycleAttempt<TPlatformResult, TNotification>
  try {
    const result = await dependencies.syncPlatformAuthorization({
      uid: input.uid,
      sourceApp: input.sourceApp,
      positionCode: input.positionCode || '',
      positionName: input.positionName || '',
      deptCode: input.primaryDeptCode || '',
      operatorUid: input.operatorUid,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey
    })
    authorizationSync = { ok: true, result }
  } catch (error) {
    const message = errorMessage(error)
    warn(dependencies.warn, '[console] Platform employment authorization sync failed:', {
      uid: input.uid,
      sourceApp: input.sourceApp,
      message
    })
    const notification = await dependencies.notifyFailure({
      uid: input.uid,
      operatorUid: input.operatorUid,
      idempotencyKey: input.idempotencyKey,
      phase: 'employment_authorization_sync',
      message,
      sourceApp: input.sourceApp
    })
    authorizationSync = { ok: false, error: message, notification }
  }

  await dependencies.writeOperationLog({
    action: 'directory.user.employment.from_people',
    uid: input.uid,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    detail: {
      sourceApp: input.sourceApp,
      reason: input.reason,
      operatorUid: input.operatorUid,
      idempotencyKey: input.idempotencyKey,
      created: input.created,
      primaryDeptCode: input.primaryDeptCode,
      positionCode: input.positionCode,
      positionName: input.positionName,
      employmentStatus: input.employmentStatus,
      authorizationSync
    }
  })

  const user = await dependencies.loadDirectoryUser(input.uid)
  return {
    user,
    created: input.created,
    authorizationSync,
    idempotencyKey: input.idempotencyKey
  }
}

export async function orchestrateOffboardingLifecycle<TUser extends { status?: unknown }, TPlatformResult, TNotification>(
  input: OffboardingLifecycleInput,
  dependencies: OffboardingLifecycleDependencies<TUser, TPlatformResult, TNotification>
) {
  const previousStatus = directoryLifecycleStatus(input.existingStatus)
  if (previousStatus !== 'inactive' && previousStatus !== 'deleted') {
    await dependencies.deactivateDirectoryUser(input.uid)
  }

  const revoked = await dependencies.revokeUserSessions(input.uid)

  let authorizationReclaim: PlatformLifecycleAttempt<TPlatformResult, TNotification>
  try {
    const result = await dependencies.reclaimPlatformAuthorization({
      uid: input.uid,
      sourceApp: input.sourceApp,
      operatorUid: input.operatorUid,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey
    })
    authorizationReclaim = { ok: true, result }
  } catch (error) {
    const message = errorMessage(error)
    warn(dependencies.warn, '[console] Platform authorization offboarding failed:', {
      uid: input.uid,
      sourceApp: input.sourceApp,
      message
    })
    const notification = await dependencies.notifyFailure({
      uid: input.uid,
      operatorUid: input.operatorUid,
      idempotencyKey: input.idempotencyKey,
      phase: 'offboarding_authorization_reclaim',
      message,
      sourceApp: input.sourceApp
    })
    authorizationReclaim = { ok: false, error: message, notification }
  }

  const user = await dependencies.loadDirectoryUser(input.uid)
  const currentStatus = directoryLifecycleStatus(user?.status)

  await dependencies.writeOperationLog({
    action: 'directory.user.disable.from_people',
    uid: input.uid,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    detail: {
      sourceApp: input.sourceApp,
      reason: input.reason,
      operatorUid: input.operatorUid,
      leaveDate: input.leaveDate,
      idempotencyKey: input.idempotencyKey,
      previousStatus,
      currentStatus,
      revoked,
      authorizationReclaim
    }
  })

  return {
    uid: input.uid,
    status: currentStatus,
    disabled: currentStatus === 'inactive',
    alreadyDisabled: previousStatus === 'inactive' || previousStatus === 'deleted',
    revoked,
    authorizationReclaim,
    idempotencyKey: input.idempotencyKey
  }
}
