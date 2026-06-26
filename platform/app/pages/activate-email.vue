<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

usePageTitle('账号激活')

const route = useRoute()
const auth = useAuth()
const pending = ref(true)
const errorMessage = ref('')
const successMessage = ref('')

function normalizeRedirect(value: unknown) {
  const redirect = String(Array.isArray(value) ? value[0] : value || '').trim()
  if (!redirect || !redirect.startsWith('/dashboard') || redirect.startsWith('//')) {
    return '/dashboard'
  }

  return redirect
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const fetchError = error as {
      data?: { message?: string, statusMessage?: string }
      message?: string
    }

    return fetchError.data?.message
      || fetchError.data?.statusMessage
      || fetchError.message
      || '账号激活失败'
  }

  return '账号激活失败'
}

async function activate() {
  const token = String(Array.isArray(route.query.token) ? route.query.token[0] : route.query.token || '').trim()
  const redirect = normalizeRedirect(route.query.redirect)

  if (!token) {
    pending.value = false
    errorMessage.value = '激活链接缺少 token'
    return
  }

  try {
    const response = await platformFetchJson<{
      success: true
      data: {
        redirect: string
      }
    }>('/api/platform/auth/activate-email', {
      method: 'POST',
      body: {
        token,
        redirect
      }
    })

    await auth.loadMe({ force: true, scope: 'dashboard' })
    successMessage.value = '账号已激活，正在进入控制台。'
    await navigateTo(response.data.redirect || redirect, { replace: true })
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  void activate()
})
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-90px)] max-w-3xl items-center px-6 py-12">
    <UCard class="w-full">
      <template #header>
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Activation
          </p>
          <h1 class="text-xl font-semibold text-slate-950">
            账号激活
          </h1>
        </div>
      </template>

      <div class="space-y-5">
        <UAlert
          v-if="pending"
          color="info"
          variant="soft"
          icon="i-lucide-loader-circle"
          title="正在验证激活链接"
        />

        <UAlert
          v-if="successMessage"
          color="success"
          variant="soft"
          icon="i-lucide-circle-check"
          :title="successMessage"
        />

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
        />

        <div
          v-if="errorMessage"
          class="flex flex-wrap gap-2"
        >
          <UButton
            color="primary"
            icon="i-lucide-log-in"
            to="/dashboard/login"
          >
            返回登录
          </UButton>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-user-plus"
            to="/dashboard/register"
          >
            重新注册
          </UButton>
        </div>
      </div>
    </UCard>
  </section>
</template>
