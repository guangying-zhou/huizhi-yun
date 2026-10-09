<script setup lang="ts">
import { projectConfidentialityLevelConfig, projectConfidentialityLevelOptions, projectSecurityLevelConfig, projectSecurityLevelOptions } from '../../config/project'
import type { ProjectConfidentialityLevel, ProjectSecurityLevel } from '../../types/aims'
import { effectiveProjectSecurityLevel } from '../../utils/projectAccessControl'

const props = withDefaults(defineProps<{
  disabled?: boolean
  showConfidentiality?: boolean
  alwaysShowWhitelist?: boolean
  showPolicyHint?: boolean
}>(), { disabled: false, showConfidentiality: false, alwaysShowWhitelist: false, showPolicyHint: true })

const securityLevel = defineModel<ProjectSecurityLevel | undefined>('securityLevel', { required: true })
const confidentialityLevel = defineModel<ProjectConfidentialityLevel>('confidentialityLevel', { default: 'L1' })
const accessWhitelist = defineModel<string[] | null | undefined>('accessWhitelist', { required: true })
const selectedUids = computed({
  get: () => accessWhitelist.value || [],
  set: (uids: string[]) => { accessWhitelist.value = uids }
})
const selectedLevel = computed(() => securityLevel.value || 'company')
const effectiveLevel = computed(() => effectiveProjectSecurityLevel(selectedLevel.value, confidentialityLevel.value))
</script>

<template>
  <div class="space-y-4">
    <UFormField v-if="props.showConfidentiality" label="密级">
      <USelect
        v-model="confidentialityLevel"
        :items="projectConfidentialityLevelOptions"
        value-key="value"
        class="w-full"
        :disabled="props.disabled"
      />
      <p class="mt-1 text-xs text-muted">
        {{ projectConfidentialityLevelConfig[confidentialityLevel].description }}
      </p>
    </UFormField>
    <UFormField label="可见范围">
      <USelect
        v-model="securityLevel"
        :items="projectSecurityLevelOptions"
        value-key="value"
        class="w-full"
        :disabled="props.disabled"
      />
      <p class="mt-1 text-xs text-muted">
        {{ projectSecurityLevelConfig[selectedLevel].description }}
      </p>
    </UFormField>
    <UAlert
      v-if="props.showPolicyHint && effectiveLevel !== selectedLevel"
      color="warning"
      title="密级将收紧可见范围"
      :description="`按服务端规则，最终范围将至少收紧至“${projectSecurityLevelConfig[effectiveLevel].label}”；保存后以服务端回读结果为准。`"
    />
    <UFormField v-if="props.alwaysShowWhitelist || selectedLevel === 'whitelist'" label="白名单">
      <UserTreeSelector
        v-model="selectedUids"
        placeholder="选择白名单用户"
        width-class="w-full"
        :disabled="props.disabled"
      />
    </UFormField>
  </div>
</template>
