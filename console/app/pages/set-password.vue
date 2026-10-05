<script setup lang="ts">
// 员工凭一次性激活链接设定登录密码。此时账号尚未可用，页面不要求登录，
// 也不使用控制台的 dashboard 布局。
definePageMeta({
  layout: false
})

useSeoMeta({
  title: '设置登录密码 · 汇智云',
  description: '通过一次性激活链接设置企业账号的登录密码。'
})

interface ActivationTarget {
  uid: string
  expiresAt: string
}

const route = useRoute()
const toast = useToast()

const token = computed(() => String(route.query.token || '').trim())
const target = ref<ActivationTarget | null>(null)
const checking = ref(true)
const submitting = ref(false)
const done = ref(false)
const linkError = ref('')

const password = ref('')
const confirmPassword = ref('')

const passwordTooShort = computed(() => password.value.length > 0 && password.value.length < 10)
const passwordMismatch = computed(() => confirmPassword.value.length > 0 && password.value !== confirmPassword.value)
const canSubmit = computed(() =>
  password.value.length >= 10 && password.value === confirmPassword.value && !submitting.value
)

const expiresAtText = computed(() => {
  const value = target.value?.expiresAt
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
})

function messageOf(error: unknown, fallback: string) {
  const data = (error as { data?: { message?: string } })?.data
  return data?.message || (error instanceof Error ? error.message : fallback)
}

onMounted(async () => {
  if (!token.value) {
    linkError.value = '链接缺少激活令牌，请使用通知中的完整链接打开。'
    checking.value = false
    return
  }
  try {
    const response = await $fetch<{ data: ActivationTarget }>('/api/v1/console/directory/activation/inspect', {
      method: 'POST',
      body: { token: token.value }
    })
    target.value = response.data
  } catch (error) {
    linkError.value = messageOf(error, '激活链接无效或已过期。')
  } finally {
    checking.value = false
  }
})

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    await $fetch('/api/v1/console/directory/activation/redeem', {
      method: 'POST',
      body: { token: token.value, newPassword: password.value }
    })
    done.value = true
    password.value = ''
    confirmPassword.value = ''
  } catch (error) {
    toast.add({ title: '设置失败', description: messageOf(error, '请稍后重试'), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted px-4 py-10">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="space-y-1">
          <h1 class="text-lg font-semibold">
            设置登录密码
          </h1>
          <p
            v-if="target"
            class="text-sm text-muted"
          >
            账号 <span class="font-mono">{{ target.uid }}</span>
          </p>
        </div>
      </template>

      <div
        v-if="checking"
        class="flex items-center gap-2 py-6 text-sm text-muted"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="animate-spin"
        />
        正在校验激活链接…
      </div>

      <UAlert
        v-else-if="linkError"
        color="error"
        variant="soft"
        icon="i-lucide-link-2-off"
        title="链接不可用"
        :description="`${linkError} 如果链接已过期，请联系人力资源或系统管理员重新发送。`"
      />

      <div
        v-else-if="done"
        class="space-y-4"
      >
        <UAlert
          color="success"
          variant="soft"
          icon="i-lucide-circle-check"
          title="密码已提交"
          description="账号正在后台完成设置，通常在一分钟内生效。生效后即可使用新密码登录。"
        />
        <UButton
          to="/login"
          color="primary"
          block
        >
          前往登录
        </UButton>
      </div>

      <form
        v-else
        class="space-y-4"
        @submit.prevent="submit"
      >
        <UFormField
          label="新密码"
          required
          :error="passwordTooShort ? '密码至少需要 10 个字符' : undefined"
        >
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            class="w-full"
            placeholder="至少 10 个字符"
          />
        </UFormField>

        <UFormField
          label="确认新密码"
          required
          :error="passwordMismatch ? '两次输入的密码不一致' : undefined"
        >
          <UInput
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            class="w-full"
          />
        </UFormField>

        <p
          v-if="expiresAtText"
          class="text-sm text-muted"
        >
          此链接在 {{ expiresAtText }} 前有效，且仅可使用一次。
        </p>

        <UButton
          type="submit"
          color="primary"
          block
          :loading="submitting"
          :disabled="!canSubmit"
        >
          设置密码
        </UButton>
      </form>
    </UCard>
  </div>
</template>
