export type Tone = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
export type ServiceRole = 'business_app' | 'directory_runtime' | 'workflow_runtime' | 'supporting_service'

export interface ApiEnvelope<T> {
  success: true
  data: T
}

export interface OpsApplication {
  id: number
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  callbackUrl: string | null
  logoutUrl: string | null
  repoUrl: string | null
  appType: string
  runtimeMode: string
  serviceRole: ServiceRole
  authMode: string
  bundleEnabled: boolean
  sortOrder: number
  status: string
  latestManifestId: number | null
  latestReleaseId: number | null
  latestReleaseVersion: string | null
  latestReleaseStatus: string | null
  latestManifestSeq: number | null
  latestManifestHash: string | null
  latestRegistrationId: number | null
  lastManifestRegisteredAt: string | null
  lastManifestReviewStatus: string | null
  lastReleasedAt: string | null
  subscriberCount: number
  activeDeploymentCount: number
  warningDeploymentCount: number
  resourceCount: number
  actionCount: number
  createdAt: string
  updatedAt: string
}

export interface OpsApplicationList {
  items: OpsApplication[]
  total: number
  page: number
  pageSize: number
}

export interface OpsRelease {
  id: number
  appCode: string
  releaseVersion: string
  sourceTag: string
  sourceCommitSha: string | null
  manifestId: number
  manifestSeq: number
  manifestHash: string
  status: string
  bundleUri: string | null
  bundleHash: string | null
  bundleSizeBytes: number | null
  releasedAt: string | null
  createdAt: string
  updatedAt: string
  isLatestReleased: boolean
  resourceCount: number
  actionCount: number
  missingGrantActionCount: number
  missingActions: string[]
}

export interface OpsManifest {
  id: number
  appCode: string
  manifestSeq: number
  manifestHash: string
  manifestJson: Record<string, unknown>
  status: string
  createdAt: string
  releaseVersions: string[]
  resourceCount: number
  actionCount: number
  isLatest: boolean
}

export interface OpsResource {
  id: number
  manifestId: number
  manifestSeq: number
  appCode: string
  resourceCode: string
  resourceName: string
  description: string | null
  sortOrder: number
  actions: Array<{
    id: number
    action: string
    actionCode: string
    actionName: string | null
    description: string | null
    sortOrder: number
    requiresGrant: boolean
  }>
}

export interface OpsOverview {
  stats: {
    activeTenantCount: number
    appCount: number
    releasedAppCount: number
    draftReleaseCount: number
    monthSubscriptionCount: number
    deploymentCount: number
    healthyDeploymentCount: number
    healthyDeploymentRate: number | null
  }
  tenants: Array<{
    tenantCode: string
    tenantName: string
    planCode: string | null
    status: string
    appCount: number
    warnCount: number
    lastHeartbeatAt: string | null
    lastSeen: string
  }>
  apps: Array<{
    appCode: string
    appName: string
    icon: string | null
    status: string
    latestReleaseVersion: string | null
    latestReleaseStatus: string | null
    subscriberCount: number
  }>
  timeline: Array<{
    tone: Tone
    time: string
    who: string
    message: string
    targetTenantCode: string | null
    createdAt: string
  }>
}

export const ROLE_TONE: Record<ServiceRole, Tone> = {
  business_app: 'info',
  directory_runtime: 'neutral',
  workflow_runtime: 'primary',
  supporting_service: 'warning'
}

export const STATUS_TONE: Record<string, Tone> = {
  released: 'success',
  draft: 'info',
  permissions_pending: 'warning',
  ready: 'warning',
  deprecated: 'neutral',
  active: 'success',
  suspended: 'warning',
  disabled: 'neutral',
  pending: 'info'
}

export function roleLabel(value: string) {
  if (value === 'business_app') return '业务应用'
  if (value === 'directory_runtime') return '目录运行时'
  if (value === 'workflow_runtime') return '工作流运行时'
  if (value === 'supporting_service') return '平台服务'
  return value
}

export function statusTone(value: string | null | undefined): Tone {
  return value ? STATUS_TONE[value] || 'neutral' : 'neutral'
}

export function appIcon(app: Pick<OpsApplication, 'icon' | 'appName' | 'appCode'> | { icon: string | null, appName: string, appCode: string }) {
  return app.icon || app.appName?.slice(0, 1) || app.appCode.slice(0, 1).toUpperCase()
}

export function appIconFallback(app: Pick<OpsApplication, 'appName' | 'appCode'> | { appName: string, appCode: string }) {
  return app.appName?.slice(0, 1) || app.appCode.slice(0, 1).toUpperCase()
}

export function isAppIconName(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) return false
  if (/^(https?:)?\/\//.test(normalized)) return false
  if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) return false
  if (normalized.startsWith('data:')) return false
  return normalized.startsWith('i-') || /^[a-z0-9-]+:[a-z0-9-]+$/i.test(normalized)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
