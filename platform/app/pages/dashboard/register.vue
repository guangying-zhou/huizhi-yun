<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

usePageTitle('企业管理员注册')

const route = useRoute()
const auth = useAuth()
const pending = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const form = reactive({
  displayName: '',
  email: '',
  password: '',
  confirmPassword: ''
})

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
      || '注册失败'
  }

  return '注册失败'
}

async function handleRegister() {
  errorMessage.value = ''
  successMessage.value = ''

  if (form.password !== form.confirmPassword) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }

  pending.value = true

  try {
    await auth.registerWithEmail({
      email: form.email,
      password: form.password,
      displayName: form.displayName,
      redirect: normalizeRedirect(route.query.redirect)
    })

    successMessage.value = '注册成功，激活邮件已发送。请打开邮箱中的链接完成激活。'
    form.password = ''
    form.confirmPassword = ''
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-90px)] max-w-7xl items-center px-6 py-12 lg:px-10">
    <div class="grid w-full gap-8 lg:grid-cols-[0.95fr_1.05fr]">
      <div class="space-y-4">
        <p class="text-sm font-semibold text-primary">
          汇智云 · 企业工作台
        </p>
        <h1 class="text-3xl font-semibold text-highlighted">
          创建企业管理员账号
        </h1>
        <p class="text-base leading-7 text-muted">
          该账号用于企业工作台。激活后可创建或加入企业，再管理本企业应用和授权。
        </p>
      </div>

      <UCard class="max-w-xl">
        <template #header>
          <h2 class="text-lg font-semibold text-highlighted">
            邮箱注册
          </h2>
        </template>

        <form
          class="space-y-4"
          @submit.prevent="handleRegister"
        >
          <UFormField label="邮箱">
            <UInput
              v-model="form.email"
              type="email"
              autocomplete="email"
              icon="i-lucide-mail"
              class="w-full"
              placeholder="admin@example.com"
              size="lg"
            />
          </UFormField>

          <UFormField label="密码">
            <UInput
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              icon="i-lucide-lock"
              class="w-full"
              placeholder="至少 8 位"
              size="lg"
            />
          </UFormField>

          <UFormField label="确认密码">
            <UInput
              v-model="form.confirmPassword"
              type="password"
              autocomplete="new-password"
              class="w-full"
              icon="i-lucide-lock-keyhole"
              placeholder="再次输入密码"
              size="lg"
            />
          </UFormField>

          <UAlert
            v-if="errorMessage"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :title="errorMessage"
          />

          <UAlert
            v-if="successMessage"
            color="success"
            variant="soft"
            icon="i-lucide-mail-check"
            :title="successMessage"
          />

          <UButton
            block
            size="lg"
            color="primary"
            icon="i-lucide-user-plus"
            type="submit"
            :loading="pending"
          >
            注册并发送激活邮件
          </UButton>

          <div class="text-center text-sm text-muted">
            已有账号？
            <UButton
              color="neutral"
              variant="link"
              to="/dashboard/login"
              class="px-1"
            >
              去登录
            </UButton>
          </div>
        </form>
      </UCard>
    </div>
  </section>
</template>
