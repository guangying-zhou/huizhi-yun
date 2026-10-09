<script setup lang="ts">
const tab = ref('records')
const error = ref('')
const busy = ref(false)
const settings = ref({ enabled: false, integrationCode: 'gitlab.default', project: 'huizhi-yun/huizhiyun', publicUrl: '', wecomIntegrationCode: 'wecom.default', revision: 0 })
const uids = ref('')
const roles = ref('system_admin')
const labels = reactive({ bug: '', feature: '', suggestion: '' })
const { confirm } = useConfirm()
async function loadSettings() {
  busy.value = true
  error.value = ''
  try {
    const r = await $fetch<{
      data: typeof settings.value & {
        recipientUids: string[]
        recipientRoleCodes: string[]
        labels: Record<string, string[]>
      }
    }>('/api/v1/console/feedback-settings')
    const { recipientUids, recipientRoleCodes, labels: mappings, ...rest } = r.data
    settings.value = rest
    uids.value = recipientUids.join(', ')
    roles.value = recipientRoleCodes.join(', ')
    for (const k of ['bug', 'feature', 'suggestion'] as const)
      labels[k] = (mappings[k] || []).join(', ')
  } catch {
    error.value = '无法读取配置，请确认配置查看权限或稍后重试。'
  } finally {
    busy.value = false
  }
}
const split = (value: string) => [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))]
async function save() {
  if (!await confirm({ title: '保存反馈配置？', message: '新反馈使用此配置；已受理反馈保留提交时的目标和接收人规则。', confirmLabel: '保存' }))
    return
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/v1/console/feedback-settings', { method: 'PATCH', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { settings: { ...settings.value, recipientUids: split(uids.value), recipientRoleCodes: split(roles.value), labels: Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, split(value)])) } } })
    await loadSettings()
  } catch (e) {
    error.value = Number((e as {
      statusCode?: number
    }).statusCode) === 409
      ? '配置已变化，请重新加载后保存。'
      : '保存失败，请检查输入与编辑权限。'
  } finally {
    busy.value = false
  }
}
watch(tab, (value) => {
  if (value === 'settings')
    void loadSettings()
})
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <div class="flex gap-2">
      <UButton :variant="tab === 'records' ? 'solid' : 'outline'" @click="tab = 'records'">
        反馈记录
      </UButton><UButton :variant="tab === 'settings' ? 'solid' : 'outline'" @click="tab = 'settings'">
        反馈配置
      </UButton>
    </div>
    <FeedbackRecords v-if="tab === 'records'" admin />
    <UCard v-else>
      <div class="space-y-4">
        <h1 class="text-xl font-semibold">
          反馈配置
        </h1>
        <UAlert v-if="error" color="warning" :description="error" />
        <UCheckbox v-model="settings.enabled" label="启用反馈" />
        <UFormField label="目标项目">
          <UInput :model-value="settings.project" disabled class="w-full" />
        </UFormField>
        <UFormField label="GitLab 集成代码">
          <UInput v-model="settings.integrationCode" class="w-full" />
        </UFormField>
        <UFormField label="企业微信集成代码">
          <UInput v-model="settings.wecomIntegrationCode" class="w-full" />
        </UFormField>
        <UFormField label="租户公共入口" description="完整 HTTPS 地址，不含路径、查询参数；须与部署公共入口一致。">
          <UInput v-model="settings.publicUrl" placeholder="https://aidcp.wiztek.cn" class="w-full" />
        </UFormField>
        <UFormField label="反馈接收人 UID" description="多个值以英文逗号分隔；与角色接收人合并去重。">
          <UInput v-model="uids" class="w-full" />
        </UFormField>
        <UFormField label="反馈接收角色" description="默认 system_admin；接收人还需处于活跃状态并具备租户范围的反馈查看权限。">
          <UInput v-model="roles" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField v-for="(label, key) in { bug: '问题标签', feature: '需求标签', suggestion: '建议标签' }" :key="key" :label="label">
            <UInput v-model="labels[key]" class="w-full" placeholder="英文逗号分隔" />
          </UFormField>
        </div>
        <p class="text-sm text-muted">
          凭据在 Console 集成与凭证保险箱管理，此页不读取或显示 Token。
        </p>
        <div class="flex gap-2">
          <UButton :loading="busy" @click="save">
            保存配置
          </UButton><UButton
            color="neutral"
            variant="outline"
            :disabled="busy"
            @click="loadSettings"
          >
            重新加载
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
