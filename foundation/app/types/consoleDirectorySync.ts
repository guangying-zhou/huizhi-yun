export interface DirectorySyncJob {
  jobCode: string
  providerCode: string
  syncType: string
  objectScope: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  requestedBy?: string | null
  totalCount: number
  createdCount: number
  updatedCount: number
  deletedCount: number
  skippedCount: number
  errorCount: number
  errorMessage?: string | null
  failureCategory?: string | null
  createdAt: string
  updatedAt?: string
}

export interface DirectorySyncEvent {
  id: number
  jobCode: string
  objectType: string
  objectCode: string
  changeType: string
  sourceProvider: string
  externalRef?: string | null
  status: string
  message?: string | null
  failureCategory?: string | null
  beforeHash?: string | null
  afterHash?: string | null
  createdAt: string
}
