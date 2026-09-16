export type AltocInstanceConflictTargetType = 'quotation' | 'contract' | 'receivable'
export type AltocInstanceConflictAction = 'approve' | 'confirm'

interface ApiResponse<T> {
  code?: number
  data?: T
  message?: string
}

export interface RuntimeInstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor: boolean
}

export interface RuntimeInstanceConflictExplanation {
  tenantCode: string
  uid: string
  requested: {
    appCode: string
    resourceCode: string
    action: string
  }
  principals: RuntimeInstanceConflictPrincipal[]
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: Array<{
    ruleCode?: string
    ruleName?: string
    enforcement?: string
    status?: string
    reasonCode?: string
    message?: string
    counterpart?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
    requested?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
  }>
}

export interface AltocInstanceConflictExplainData {
  targetType: AltocInstanceConflictTargetType
  id: string
  code: string | null
  action: AltocInstanceConflictAction
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplanation
}

interface OpenAltocConflictOptions {
  targetType: AltocInstanceConflictTargetType
  id: string | number
  action: AltocInstanceConflictAction
  label: string
}

export function useAltocInstanceConflictExplanation() {
  const conflictModalOpen = ref(false)
  const conflictLoading = ref(false)
  const conflictResult = ref<AltocInstanceConflictExplainData | null>(null)
  const conflictTargetId = ref('')
  const conflictTargetType = ref<AltocInstanceConflictTargetType | ''>('')
  const conflictTargetLabel = ref('')
  const toast = useToast()

  async function openConflictExplanation(options: OpenAltocConflictOptions) {
    const id = String(options.id || '').trim()
    if (!id) {
      toast.add({
        title: '职责冲突解释失败',
        description: '缺少业务对象 ID。',
        color: 'error',
        icon: 'i-lucide-triangle-alert'
      })
      return
    }

    conflictTargetId.value = id
    conflictTargetType.value = options.targetType
    conflictTargetLabel.value = options.label
    conflictResult.value = null
    conflictModalOpen.value = true
    conflictLoading.value = true
    try {
      const response = await $fetch<ApiResponse<AltocInstanceConflictExplainData>>('/api/v1/authorization/instance-conflict-explain', {
        method: 'POST',
        body: {
          targetType: options.targetType,
          id,
          action: options.action
        }
      })
      if (!response.data) {
        throw new Error('实例职责冲突解释结果为空。')
      }
      conflictResult.value = response.data
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.add({
        title: '职责冲突解释失败',
        description: message,
        color: 'error',
        icon: 'i-lucide-triangle-alert'
      })
      conflictModalOpen.value = false
    } finally {
      conflictLoading.value = false
    }
  }

  function isConflictLoading(targetType: AltocInstanceConflictTargetType, id: string | number) {
    return conflictLoading.value
      && conflictTargetType.value === targetType
      && conflictTargetId.value === String(id || '').trim()
  }

  return {
    conflictModalOpen,
    conflictLoading,
    conflictResult,
    conflictTargetId,
    conflictTargetType,
    conflictTargetLabel,
    openConflictExplanation,
    isConflictLoading
  }
}
