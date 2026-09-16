/**
 * 反馈浮动按钮开关
 *
 * 读取 Console 系统参数 `feedback.reporter.enabled`，决定各应用是否展示反馈浮动按钮。
 * 通过 Foundation 本地端点 `/api/runtime/feedback-reporter` 解析（端点内部走 Console
 * service token + runtime settings 缓存），客户端再做一次模块级缓存，只请求一次。
 *
 * 默认启用：当 Console 不可达或参数缺失时回退为 true，保持现有反馈采集能力。
 */

import {
  buildShellCacheFingerprint,
  readShellSessionCache,
  writeShellSessionCache
} from '../utils/shellSessionCache'

const FEEDBACK_REPORTER_CACHE_KEY = 'hzy:feedback-reporter:v1'
const FEEDBACK_REPORTER_CACHE_TTL_MS = 5 * 60_000

// 模块级缓存，所有 composable 实例共享
const enabled = ref(true)
const loaded = ref(false)
let loadedFingerprint = ''
let pendingLoad: Promise<void> | null = null

export function useFeedbackReporter() {
  const auth = useAuth()

  const load = async () => {
    const fingerprint = buildShellCacheFingerprint({
      authenticated: auth.authenticated.value,
      user: auth.user.value,
      tenant: auth.tenant.value,
      policyVersion: auth.policyVersion.value
    })

    if (loaded.value && fingerprint === loadedFingerprint) return
    if (import.meta.client && fingerprint) {
      const cached = readShellSessionCache(
        sessionStorage,
        FEEDBACK_REPORTER_CACHE_KEY,
        fingerprint,
        FEEDBACK_REPORTER_CACHE_TTL_MS,
        value => typeof value === 'boolean' ? value : null
      )
      if (cached) {
        enabled.value = cached.value
        loaded.value = true
        loadedFingerprint = fingerprint
        return
      }
    }

    if (pendingLoad) return await pendingLoad

    loaded.value = true
    loadedFingerprint = fingerprint
    pendingLoad = (async () => {
      try {
        const res = await $fetch<{ code: number, data: { enabled: boolean } }>('/api/runtime/feedback-reporter')
        enabled.value = res?.data?.enabled !== false
        if (import.meta.client && fingerprint) {
          writeShellSessionCache(
            sessionStorage,
            FEEDBACK_REPORTER_CACHE_KEY,
            fingerprint,
            enabled.value
          )
        }
      } catch {
        // 静默，使用兜底值（启用）
      } finally {
        pendingLoad = null
      }
    })()

    return await pendingLoad
  }

  if (import.meta.client) {
    onMounted(load)
  }

  return { enabled, load }
}
