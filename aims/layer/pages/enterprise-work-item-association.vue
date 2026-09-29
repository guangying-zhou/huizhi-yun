<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
type Choice = { version_id: number, product_code: string, version_code: string, version_name?: string, feature_id?: number, feature_name?: string }
const route = useRoute(), router = useRouter(), { moduleUrl } = useAimsModule()
const id = computed(() => String(route.params.id || ''))
const projectId = ref(''), version = ref(''), choices = ref<Choice[]>([]), versionId = ref('none'), featureId = ref('none'), loading = ref(true), saving = ref(false), error = ref(''), key = ref('')
const versions = computed(() => [{ label: '不关联版本', value: 'none' }, ...Array.from(new Map(choices.value.map(c => [c.version_id, { label: `${c.product_code} / ${c.version_code}${c.version_name ? ` · ${c.version_name}` : ''}`, value: String(c.version_id) }])).values())])
const features = computed(() => [{ label: '不指定功能特性', value: 'none' }, ...choices.value.filter(c => String(c.version_id) === versionId.value && c.feature_id).map(c => ({ label: c.feature_name || '未命名特性', value: String(c.feature_id) }))])
watch(versionId, () => { featureId.value = 'none' })
onMounted(async () => { try {
  const r = await $fetch<{ data?: { editSnapshot?: Record<string, unknown>, editVersion?: string, associationOptions?: Choice[] } }>(moduleUrl(`/api/v1/work-items/${id.value}`))
  const p = r.data?.editSnapshot
  if (!p || p.tier !== 'target' || !r.data?.editVersion) throw Error('只有目标工作项可以关联产品版本')
  projectId.value = String(p.project_id); version.value = r.data.editVersion; choices.value = r.data.associationOptions || []
  versionId.value = p.version_id ? String(p.version_id) : 'none'
  await nextTick(); featureId.value = p.feature_id ? String(p.feature_id) : 'none'
} catch (e) { error.value = e instanceof Error ? e.message : '关联信息暂不可用' } finally { loading.value = false } })
async function save() { saving.value = true; error.value = ''; key.value ||= crypto.randomUUID(); try {
  await $fetch(moduleUrl(`/api/v1/work-items/${id.value}/association`), { method: 'PUT', headers: { 'Idempotency-Key': key.value }, body: { projectId: projectId.value, expectedVersion: version.value, versionId: versionId.value === 'none' ? null : Number(versionId.value), featureId: featureId.value === 'none' ? null : Number(featureId.value) } })
  await router.push(moduleUrl(`/work-items/${id.value}`))
} catch (e) { error.value = e instanceof Error ? e.message : '保存失败，请重试' } finally { saving.value = false } }
</script>
<template><section class="mx-auto max-w-2xl space-y-5"><UButton :to="moduleUrl(`/work-items/${id}`)" variant="link">返回工作项</UButton><h1 class="text-2xl font-semibold">产品版本关联</h1><UAlert description="只能关联本项目可见且处于规划或开发中的版本；变更同时更新版本范围修订。已发布版本的关联不能修改。"/><UAlert v-if="error" color="error" title="操作失败" :description="error"/><USkeleton v-if="loading" class="h-48"/><UCard v-else-if="version"><div class="space-y-4"><UFormField label="产品版本"><USelect v-model="versionId" :items="versions" class="w-full"/></UFormField><UFormField v-if="versionId !== 'none'" label="功能特性"><USelect v-model="featureId" :items="features" class="w-full"/></UFormField><UButton :loading="saving" @click="save">保存关联</UButton></div></UCard></section></template>
