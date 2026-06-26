/**
 * 反馈浮动按钮开关
 *
 * 读取 Console 系统参数 `feedback.reporter.enabled`，决定各应用是否展示反馈浮动按钮。
 * 通过 Foundation 本地端点 `/api/runtime/feedback-reporter` 解析（端点内部走 Console
 * service token + runtime settings 缓存），客户端再做一次模块级缓存，只请求一次。
 *
 * 默认启用：当 Console 不可达或参数缺失时回退为 true，保持现有反馈采集能力。
 */

// 模块级缓存，所有 composable 实例共享
const enabled = ref(true)
const loaded = ref(false)

export function useFeedbackReporter() {
  const load = async () => {
    if (loaded.value) return
    loaded.value = true
    try {
      const res = await $fetch<{ code: number, data: { enabled: boolean } }>('/api/runtime/feedback-reporter')
      enabled.value = res?.data?.enabled !== false
    } catch {
      // 静默，使用兜底值（启用）
    }
  }

  if (import.meta.client) {
    onMounted(load)
  }

  return { enabled, load }
}
