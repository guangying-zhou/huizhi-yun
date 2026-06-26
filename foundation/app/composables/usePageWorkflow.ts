/**
 * usePageWorkflow — 页面级流程声明（多动作模式）
 *
 * 支持同一页面注册多个审批动作（如立项/暂停/结项/重启），
 * 由页面根据业务状态动态返回当前可用的动作列表。
 *
 * 规则：同一业务实体同一时刻只允许一个活跃审批实例。
 *
 * 使用方式：
 *   usePageWorkflow({
 *     appCode: 'aims',
 *     resourceCode: 'projects',
 *     bizId: computed(() => String(id)),
 *     bizTitle: computed(() => title),
 *     actions: computed(() => {
 *       if (status === 'draft') return [
 *         { actionCode: 'initiation', actionName: '立项申请', canSubmit, completenessIssues }
 *       ]
 *       if (status === 'running') return [
 *         { actionCode: 'pause', actionName: '项目暂停', canSubmit: ref(true), completenessIssues: ref([]) },
 *         { actionCode: 'close', actionName: '项目结项', canSubmit: closeReady, completenessIssues: closeIssues }
 *       ]
 *       return []
 *     })
 *   })
 */
import type { WorkflowLaunchPayload, PageWorkflowAction, PageWorkflowCallbackPayload } from '../types/workflow'

export interface PageWorkflowConfig {
  appCode: string
  resourceCode: string
  bizId: ComputedRef<string>
  bizTitle: ComputedRef<string>
  bizUrl?: ComputedRef<string>
  /** 可选的业务上下文（传给审批实例，用于 embed_url_pattern 的 {biz_context.xxx} 替换） */
  bizContext?: ComputedRef<Record<string, unknown>>
  /** 可选的表单数据（传给 Workflow form_data，用于路由、审批人解析和回调） */
  formData?: ComputedRef<Record<string, unknown>>
  /** 可选的终态回调地址 */
  callbackUrl?: ComputedRef<string>
  /** 当前可用的动作列表（响应式，随业务状态变化） */
  actions: ComputedRef<PageWorkflowAction[]>
}

// ─── 模块级共享状态 ───
const _config = shallowRef<PageWorkflowConfig | null>(null)
const _configVersion = ref(0)

/** 当前选中的动作索引 */
const _selectedIndex = ref(0)

/** 活跃实例信息（某个动作已有进行中的审批） */
const _activeInstance = ref<{ actionCode: string, status: string } | null>(null)

/** 按动作追踪已处理的实例状态，避免重复触发回调 */
const _handledStatusMap = ref<Map<string, string>>(new Map())

/**
 * 读取当前页面的流程配置（供 LayoutSidebar 使用）
 */
export function usePageWorkflowState() {
  const config = computed(() => {
    void _configVersion.value
    return _config.value
  })

  /** 当前可用动作列表 */
  const actions = computed(() => {
    void _configVersion.value
    return config.value?.actions.value ?? []
  })

  /** 是否有页面流程 */
  const hasPageWorkflow = computed(() => actions.value.length > 0)

  /** 是否有多个动作 */
  const hasMultipleActions = computed(() => actions.value.length > 1)

  /** 当前选中的动作索引（确保不越界） */
  const selectedIndex = computed({
    get: () => {
      const idx = _selectedIndex.value
      return idx < actions.value.length ? idx : 0
    },
    set: (val: number) => {
      _selectedIndex.value = val
    }
  })

  /** 当前选中的动作 */
  const selectedAction = computed(() => actions.value[selectedIndex.value] ?? null)

  /** 是否有活跃实例（锁定其他动作） */
  const activeInstance = computed(() => _activeInstance.value)

  /** 当前选中动作对应的 launchPayload */
  const launchPayload = computed<WorkflowLaunchPayload | null>(() => {
    void _configVersion.value
    const cfg = config.value
    const action = selectedAction.value
    if (!cfg || !action) return null
    const bizId = cfg.bizId.value
    if (!bizId || bizId === '0' || bizId === 'NaN') return null
    return {
      appCode: cfg.appCode,
      resourceCode: cfg.resourceCode,
      actionCode: action.actionCode,
      actionName: action.actionName,
      bizId,
      bizTitle: cfg.bizTitle.value,
      bizUrl: cfg.bizUrl?.value,
      bizContext: cfg.bizContext?.value,
      formData: action.formData ? unref(action.formData) : cfg.formData?.value,
      callbackUrl: action.callbackUrl ? unref(action.callbackUrl) : cfg.callbackUrl?.value
    }
  })

  /** 当前选中动作的 canSubmit */
  const canSubmit = computed(() => {
    void _configVersion.value
    return selectedAction.value?.canSubmit.value ?? false
  })

  /** 当前选中动作的 completenessIssues */
  const completenessIssues = computed(() => {
    void _configVersion.value
    return selectedAction.value?.completenessIssues.value ?? []
  })

  /** 当前选中动作的 beforeSubmit（返回稳定函数引用，内部动态读取） */
  const beforeSubmit = async () => {
    await selectedAction.value?.beforeSubmit?.()
  }

  // 已完结的实例状态（不算"活跃"，不锁定其他动作）
  const terminalStatuses = new Set(['approved', 'rejected', 'cancelled'])

  /** WorkflowPanel 回调：实例发现 */
  function setInstanceFound(payload: { found: boolean, status?: string }) {
    const action = selectedAction.value
    if (!action) return

    if (payload.found && payload.status) {
      const isTerminal = terminalStatuses.has(payload.status)

      // 只有进行中的实例才算"活跃"，锁定其他动作
      if (!isTerminal) {
        _activeInstance.value = { actionCode: action.actionCode, status: payload.status }
      } else if (_activeInstance.value?.actionCode === action.actionCode) {
        // 之前活跃的实例已完结，解除锁定
        _activeInstance.value = null
      }

      // 回调仅在从 running → approved/rejected 状态变化时触发
      // 页面首次加载发现的历史状态不触发回调
      const prevStatus = _handledStatusMap.value.get(action.actionCode)
      if (prevStatus && !terminalStatuses.has(prevStatus) && payload.status !== prevStatus) {
        // 之前记录的是非终态（如 running），现在变了 → 触发回调
        if (payload.status === 'approved') action.onApproved?.({ instanceId: 0, instanceStatus: payload.status })
        else if (payload.status === 'rejected') action.onRejected?.({ instanceId: 0, instanceStatus: payload.status })
      }
      _handledStatusMap.value.set(action.actionCode, payload.status)
    } else {
      // 无实例
      if (_activeInstance.value?.actionCode === action.actionCode) {
        _activeInstance.value = null
      }
    }
  }

  function onSubmitted(payload: PageWorkflowCallbackPayload) {
    selectedAction.value?.onSubmitted?.(payload)
  }

  function onApproved(payload: PageWorkflowCallbackPayload) {
    selectedAction.value?.onApproved?.(payload)
  }

  function onRejected(payload: PageWorkflowCallbackPayload) {
    selectedAction.value?.onRejected?.(payload)
  }

  /** 选择指定动作 */
  function selectAction(index: number) {
    if (index >= 0 && index < actions.value.length) {
      _selectedIndex.value = index
    }
  }

  return {
    hasPageWorkflow,
    hasMultipleActions,
    actions,
    selectedIndex,
    selectedAction,
    activeInstance,
    launchPayload,
    canSubmit,
    completenessIssues,
    beforeSubmit,
    setInstanceFound,
    onSubmitted,
    onApproved,
    onRejected,
    selectAction
  }
}

/**
 * 页面调用：声明本页需要审批流程（多动作模式）
 */
export function usePageWorkflow(options: {
  appCode: string
  resourceCode: string
  bizId: Ref<string> | ComputedRef<string>
  bizTitle: Ref<string> | ComputedRef<string>
  bizUrl?: Ref<string> | ComputedRef<string>
  /** 可选的业务上下文（用于 embed_url_pattern 的 {biz_context.xxx} 替换） */
  bizContext?: Ref<Record<string, unknown>> | ComputedRef<Record<string, unknown>>
  /** 可选的表单数据（写入 Workflow form_data） */
  formData?: Ref<Record<string, unknown>> | ComputedRef<Record<string, unknown>>
  /** 可选的终态回调地址 */
  callbackUrl?: Ref<string> | ComputedRef<string>
  /** 当前可用的审批动作列表（响应式） */
  actions: ComputedRef<PageWorkflowAction[]>
}) {
  const config: PageWorkflowConfig = {
    appCode: options.appCode,
    resourceCode: options.resourceCode,
    bizId: computed(() => unref(options.bizId)),
    bizTitle: computed(() => unref(options.bizTitle)),
    bizUrl: options.bizUrl ? computed(() => unref(options.bizUrl!)) : undefined,
    bizContext: options.bizContext ? computed(() => unref(options.bizContext!)) : undefined,
    formData: options.formData ? computed(() => unref(options.formData!)) : undefined,
    callbackUrl: options.callbackUrl ? computed(() => unref(options.callbackUrl!)) : undefined,
    actions: options.actions
  }

  // 注册到共享状态
  _config.value = config
  _selectedIndex.value = 0
  _activeInstance.value = null
  _handledStatusMap.value.clear()

  // 记录上一次的 actionCode 组合，仅实质变化时才重置选中索引
  let prevActionCodes = options.actions.value.map(a => a.actionCode).join(',')

  // actions 变化时递增版本号，通知 LayoutSidebar 更新
  const stopActionsWatch = watch(options.actions, (newActions) => {
    _configVersion.value++
    const newCodes = newActions.map(a => a.actionCode).join(',')
    if (newCodes !== prevActionCodes) {
      // 动作集合真正变了，才重置
      prevActionCodes = newCodes
      _selectedIndex.value = 0
      _activeInstance.value = null
      _handledStatusMap.value.clear()
    }
  })

  // bizId/bizTitle 变化时也递增版本号
  const stopBizWatch = watch([() => unref(options.bizId), () => unref(options.bizTitle)], () => {
    _configVersion.value++
  })

  // 页面卸载时清除
  if (getCurrentInstance()) {
    onUnmounted(() => {
      stopActionsWatch()
      stopBizWatch()
      if (_config.value === config) {
        _config.value = null
        _selectedIndex.value = 0
        _activeInstance.value = null
        _handledStatusMap.value.clear()
      }
    })
  }

  // 只读判定：有活跃实例且不是被驳回状态
  const isReadonly = computed(() => {
    const inst = _activeInstance.value
    return !!inst && inst.status !== 'rejected'
  })

  return { isReadonly }
}
