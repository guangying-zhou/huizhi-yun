<script setup lang="ts">
type AuthorizationSimulationMode = 'role_simulation' | 'user_simulation'

const toast = useToast()
const { authenticated } = useAuth()
const { loadAuthorization, getAuthorization } = useAuthorization()
const {
  active,
  canSimulateRole,
  canSimulateUser,
  capabilityLoading,
  loadPlatformSimulationCapabilities,
  startSession
} = useAuthorizationSimulationSession()

const open = ref(false)
const submitting = ref(false)
const form = reactive({
  mode: 'role_simulation' as AuthorizationSimulationMode,
  roleCode: '',
  subjectCode: '',
  includeBaseline: true,
  ttlMinutes: '30',
  reason: ''
})

const availableRoles = computed(() => getAuthorization()?.availableRoles || [])
const roleOptions = computed(() => availableRoles.value.slice(0, 6))
const canOpen = computed(() => authenticated.value && !active.value && (canSimulateRole.value || canSimulateUser.value))
const selectedModeAllowed = computed(() => {
  return form.mode === 'user_simulation' ? canSimulateUser.value : canSimulateRole.value
})
const targetReady = computed(() => {
  return form.mode === 'user_simulation'
    ? Boolean(form.subjectCode.trim())
    : Boolean(form.roleCode.trim())
})
const canSubmit = computed(() => selectedModeAllowed.value && targetReady.value && !submitting.value)

const modeOptions = computed(() => [
  { label: '角色模拟', value: 'role_simulation', disabled: !canSimulateRole.value },
  { label: '用户模拟', value: 'user_simulation', disabled: !canSimulateUser.value }
])

onMounted(async () => {
  if (!authenticated.value) return
  await Promise.all([
    loadPlatformSimulationCapabilities(),
    loadAuthorization()
  ])
})

watch(authenticated, (isAuthenticated) => {
  if (!isAuthenticated) return
  void loadPlatformSimulationCapabilities({ force: true })
  void loadAuthorization()
})

watch([canSimulateRole, canSimulateUser], () => {
  if (form.mode === 'role_simulation' && !canSimulateRole.value && canSimulateUser.value) {
    form.mode = 'user_simulation'
  }
  if (form.mode === 'user_simulation' && !canSimulateUser.value && canSimulateRole.value) {
    form.mode = 'role_simulation'
  }
}, { immediate: true })

function openModal() {
  if (!canOpen.value) return
  if (canSimulateRole.value) {
    form.mode = 'role_simulation'
    form.roleCode ||= getAuthorization()?.activeRoleCode || availableRoles.value[0]?.roleCode || ''
  } else {
    form.mode = 'user_simulation'
  }
  open.value = true
}

function pickRole(roleCode: string) {
  form.roleCode = roleCode
}

async function submit() {
  if (!canSubmit.value) return

  submitting.value = true
  try {
    const ttlMinutes = Number(form.ttlMinutes)
    await startSession({
      mode: form.mode,
      roleCode: form.mode === 'role_simulation' ? form.roleCode.trim() : null,
      subjectCode: form.mode === 'user_simulation' ? form.subjectCode.trim() : null,
      includeBaseline: form.includeBaseline,
      ttlMinutes: Number.isFinite(ttlMinutes) ? ttlMinutes : 30,
      reason: form.reason.trim() || null
    })
    open.value = false
    toast.add({
      title: '已启动模拟',
      color: 'warning',
      icon: 'i-lucide-shield-alert'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '启动模拟失败'
    toast.add({
      title: '启动模拟失败',
      description: message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="启动权限模拟"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <UTooltip
      text="权限模拟"
      :content="{ side: 'bottom' }"
    >
      <UButton
        v-if="canOpen || capabilityLoading"
        icon="i-lucide-shield-alert"
        color="warning"
        variant="ghost"
        square
        size="sm"
        :loading="capabilityLoading"
        :disabled="!canOpen"
        aria-label="权限模拟"
        @click="openModal"
      />
    </UTooltip>

    <template #body>
      <div class="space-y-4">
        <UFormField label="模式" required>
          <USelect
            v-model="form.mode"
            :items="modeOptions"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="form.mode === 'role_simulation'"
          label="企业角色编码"
          required
        >
          <UInput
            v-model="form.roleCode"
            class="w-full font-mono"
            placeholder="finance_director"
          />
          <div
            v-if="roleOptions.length"
            class="mt-2 flex flex-wrap gap-1.5"
          >
            <UButton
              v-for="role in roleOptions"
              :key="role.roleCode"
              size="xs"
              color="neutral"
              :variant="form.roleCode === role.roleCode ? 'solid' : 'soft'"
              @click="pickRole(role.roleCode)"
            >
              {{ role.roleName || role.roleCode }}
            </UButton>
          </div>
        </UFormField>

        <UFormField
          v-else
          label="用户 Subject Code"
          required
        >
          <UInput
            v-model="form.subjectCode"
            class="w-full font-mono"
            placeholder="u100"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="有效期">
            <USelect
              v-model="form.ttlMinutes"
              :items="[
                { label: '5 分钟', value: '5' },
                { label: '15 分钟', value: '15' },
                { label: '30 分钟', value: '30' }
              ]"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="form.mode === 'role_simulation'"
            label="包含 baseline"
          >
            <USwitch
              v-model="form.includeBaseline"
              size="md"
            />
          </UFormField>
        </div>

        <UFormField label="原因">
          <UTextarea
            v-model="form.reason"
            class="w-full"
            :rows="3"
            placeholder="排查权限配置"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          @click="open = false"
        >
          取消
        </UButton>
        <UButton
          icon="i-lucide-play"
          color="warning"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          启动
        </UButton>
      </div>
    </template>
  </UModal>
</template>
