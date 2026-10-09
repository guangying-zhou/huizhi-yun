<script setup lang="ts">
/**
 * 消息中转页
 *
 * 企业微信消息中的链接会在企业微信内置浏览器中打开，
 * 此页面提供"在默认浏览器中打开"的选项（通过 JSSDK openDefaultBrowser）。
 *
 * 查询参数：
 *   url   - 目标页面地址（必须）
 *   title - 消息标题（可选）
 *   desc  - 消息描述（可选）
 */

interface WecomInvokeResult {
  err_msg?: string
}

interface WecomConfigError {
  errMsg?: string
}

interface WecomCorpConfig {
  corpid: string
  timestamp: number
  nonceStr: string
  signature: string
}

interface WecomAgentConfig {
  corpid: string
  agentid: string | number
  timestamp: number
  nonceStr: string
  signature: string
}

interface WecomJssdkConfigData {
  corpConfig: WecomCorpConfig
  agentConfig: WecomAgentConfig
}

interface WecomJssdkConfigResponse {
  code: number
  data: WecomJssdkConfigData
}

interface WecomJsSdk {
  invoke: (method: string, params: { url: string }, callback: (res: WecomInvokeResult) => void) => void
  config: (options: {
    beta: boolean
    debug: boolean
    appId: string
    timestamp: number
    nonceStr: string
    signature: string
    jsApiList: string[]
  }) => void
  ready: (callback: () => void) => void
  error: (callback: (err: WecomConfigError) => void) => void
  agentConfig: (options: {
    corpid: string
    agentid: string | number
    timestamp: number
    nonceStr: string
    signature: string
    jsApiList: string[]
    success: () => void
    fail: (err: WecomConfigError) => void
  }) => void
}

declare global {
  interface Window {
    wx?: WecomJsSdk
  }
}

definePageMeta({
  layout: false
})

const route = useRoute()

const targetUrl = computed(() => {
  const u = route.query.url as string
  return u ? decodeURIComponent(u) : ''
})
const title = computed(() => (route.query.title as string) || '消息通知')
const desc = computed(() => (route.query.desc as string) || '')

const isWeWork = ref(false)
const sdkReady = ref(false)
const sdkError = ref('')
const loading = ref(true)

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

// 在企业微信中直接跳转
function goInWeWork() {
  if (targetUrl.value) {
    window.location.href = targetUrl.value
  }
}

// 通过 JSSDK 在默认浏览器中打开
function openInBrowser() {
  if (!targetUrl.value) return
  const wx = window.wx
  if (!wx) {
    window.open(targetUrl.value, '_blank')
    return
  }
  wx.invoke('openDefaultBrowser', { url: targetUrl.value }, (res: WecomInvokeResult) => {
    console.log('openDefaultBrowser result:', JSON.stringify(res))
    if (res.err_msg !== 'openDefaultBrowser:ok') {
      console.error('openDefaultBrowser failed:', res)
      // fallback: 尝试 window.open
      window.open(targetUrl.value, '_blank')
    }
  })
}

// 加载 JSSDK 脚本
function loadJsSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.wx) {
      resolve()
      return
    }
    // 先加载微信 JSSDK
    const script1 = document.createElement('script')
    script1.src = 'https://res.wx.qq.com/open/js/jweixin-1.2.0.js'
    script1.onload = () => {
      // 再加载企业微信专用 JSSDK（wx.agentConfig / wx.invoke 需要）
      const script2 = document.createElement('script')
      script2.src = 'https://open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js'
      script2.onload = () => resolve()
      script2.onerror = () => {
        // jwxwork 加载失败仍然继续，部分功能可能可用
        console.warn('jwxwork-1.0.0.js 加载失败，openDefaultBrowser 可能不可用')
        resolve()
      }
      document.head.appendChild(script2)
    }
    script1.onerror = () => reject(new Error('JSSDK 脚本加载失败'))
    document.head.appendChild(script1)
  })
}

// 初始化 JSSDK
async function initJsSdk() {
  const wx = window.wx
  if (!wx) return

  try {
    // 获取签名配置
    const { data } = await $fetch<WecomJssdkConfigResponse>('/api/wecom/jssdk-config', {
      params: { url: window.location.href.split('#')[0] }
    })

    // wx.config
    await new Promise<void>((resolve, reject) => {
      wx.config({
        beta: true, // 必须设置 beta: true 才能使用 wx.invoke
        debug: false,
        appId: data.corpConfig.corpid,
        timestamp: data.corpConfig.timestamp,
        nonceStr: data.corpConfig.nonceStr,
        signature: data.corpConfig.signature,
        jsApiList: ['openDefaultBrowser']
      })
      wx.ready(() => resolve())
      wx.error(err => reject(new Error(err.errMsg || 'wx.config 失败')))
    })

    // wx.agentConfig
    await new Promise<void>((resolve, reject) => {
      wx.agentConfig({
        corpid: data.agentConfig.corpid,
        agentid: data.agentConfig.agentid,
        timestamp: data.agentConfig.timestamp,
        nonceStr: data.agentConfig.nonceStr,
        signature: data.agentConfig.signature,
        jsApiList: ['openDefaultBrowser'],
        success: () => resolve(),
        fail: err => reject(new Error(err.errMsg || 'wx.agentConfig 失败'))
      })
    })

    sdkReady.value = true
  } catch (err: unknown) {
    console.error('JSSDK 初始化失败:', err)
    sdkError.value = getErrorMessage(err, 'JSSDK 初始化失败')
  }
}

onMounted(async () => {
  // 检测是否在企业微信环境
  isWeWork.value = /wxwork/i.test(navigator.userAgent)

  if (!targetUrl.value) {
    loading.value = false
    return
  }

  // 非企业微信环境，直接跳转到目标页面
  if (!isWeWork.value) {
    window.location.href = targetUrl.value
    return
  }

  // 企业微信环境，初始化 JSSDK
  try {
    await loadJsSdk()
    await initJsSdk()
  } catch (err: unknown) {
    sdkError.value = getErrorMessage(err, 'JSSDK 初始化失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
    <!-- 无目标 URL -->
    <div v-if="!targetUrl" class="text-center">
      <div class="text-6xl mb-4">
        📭
      </div>
      <p class="text-gray-500">
        无效的消息链接
      </p>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" class="text-center">
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-4" />
      <p class="text-gray-500">
        正在加载...
      </p>
    </div>

    <!-- 消息卡片 -->
    <div v-else class="w-full max-w-sm">
      <div class="bg-white rounded-2xl shadow-lg p-6">
        <!-- 标题 -->
        <h1 class="text-lg font-semibold text-gray-900 mb-2">
          {{ title }}
        </h1>
        <!-- 描述 -->
        <p v-if="desc" class="text-sm text-gray-500 mb-6">
          {{ desc }}
        </p>

        <!-- SDK 错误提示 -->
        <div v-if="sdkError" class="text-xs text-amber-600 bg-amber-50 rounded-lg p-3 mb-4">
          ⚠️ {{ sdkError }}
        </div>

        <!-- 操作按钮 -->
        <div class="space-y-3">
          <!-- 在企业微信中继续 -->
          <button
            class="w-full py-3 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
            @click="goInWeWork"
          >
            在企业微信中打开
          </button>

          <!-- 在默认浏览器中打开 -->
          <button
            class="w-full py-3 px-4 bg-white hover:bg-gray-50 text-gray-700 rounded-xl font-medium border border-gray-200 transition-colors"
            :class="{ 'opacity-50': !sdkReady && !sdkError }"
            :disabled="!sdkReady && !sdkError"
            @click="openInBrowser"
          >
            在默认浏览器中打开
          </button>
        </div>

        <!-- 提示文字 -->
        <p class="text-xs text-gray-400 text-center mt-4">
          在默认浏览器中打开可获得更好的浏览体验
        </p>
      </div>

      <!-- 汇智云 branding -->
      <p class="text-xs text-gray-300 text-center mt-6">
        汇智云 · 消息中心
      </p>
    </div>
  </div>
</template>
