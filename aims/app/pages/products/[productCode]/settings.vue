<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品设置', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const { product, workspaceStatus, workspaceError, refreshWorkspace, permissions, permissionStatus, permissionError, refreshAll } = useProductWorkspace(code)
const errorAlert = useApiErrorAlert(workspaceError, { fallbackTitle: '产品空间加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '操作权限加载失败' })
const canEdit = computed(() => permissionStatus.value === 'success' && permissions.value?.edit === true && product.value?.status === 'active')

const editing = ref(false)
const saving = ref(false)
const saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '产品空间保存失败' })
const form = reactive({ positioning: '', targetUsers: '', valueStatement: '', reason: '' })
const editRevision = ref(0)
let retry: { payload: string, key: string } | undefined
const toast = useToast()

function startEditing() {
  if (!product.value || !canEdit.value) return
  form.positioning = product.value.positioning || ''
  form.targetUsers = product.value.target_users || ''
  form.valueStatement = product.value.value_statement || ''
  form.reason = ''
  editRevision.value = product.value.revision
  saveError.value = null
  retry = undefined
  editing.value = true
}

async function saveWorkspace() {
  if (saving.value) return
  saving.value = true
  saveError.value = null
  const body = { ...form, expectedRevision: editRevision.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code.value)}`, {
      method: 'PATCH', body, headers: { 'Idempotency-Key': retry.key }
    })
    if (response.code !== 0) throw new Error('保存结果不完整，请重试')
    editing.value = false
    retry = undefined
    toast.add({ title: '产品空间已保存', color: 'success' })
    await refreshWorkspace()
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('保存失败，请重试')
  } finally {
    saving.value = false
  }
}

watch(code, () => {
  editing.value = false
  retry = undefined
  saveError.value = null
})

const positioningFields = [
  { key: 'positioning' as const, label: '产品定位' },
  { key: 'target_users' as const, label: '目标用户' },
  { key: 'value_statement' as const, label: '核心价值' }
]

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refreshAll))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="min-w-0 max-w-4xl space-y-6 p-4 sm:p-6">
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="errorAlert" v-bind="errorAlert" />
    <div
      v-if="workspaceStatus === 'pending' && !product"
      role="status"
      aria-live="polite"
      class="py-12 text-center text-sm text-muted"
    >
      正在加载产品空间…
    </div>

    <template v-else-if="product">
      <section class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-base font-semibold">
              产品信息
            </h2>
            <p class="mt-1 text-sm text-muted">
              产品定位、目标用户与核心价值会展示在各工作视角的入口处，供研发、销售与经营岗位对齐同一口径。
            </p>
          </div>
          <UButton
            v-if="canEdit && !editing"
            icon="i-lucide-pencil"
            @click="startEditing"
          >
            编辑产品信息
          </UButton>
        </div>

        <form v-if="editing" class="space-y-4 rounded-lg border border-default p-4" @submit.prevent="saveWorkspace">
          <UAlert v-if="saveAlert" v-bind="saveAlert" />
          <p class="text-sm text-muted">
            修改产品定位信息。发生版本冲突时，可读取最新内容与下方记录对照；刷新会保留表单输入。请复制需要保留的修改，再取消后重新编辑。
          </p>
          <UFormField label="产品定位" name="positioning">
            <UTextarea
              v-model="form.positioning"
              :disabled="saving"
              :maxlength="10000"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <UFormField label="目标用户" name="targetUsers">
            <UTextarea
              v-model="form.targetUsers"
              :disabled="saving"
              :maxlength="10000"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <UFormField label="核心价值" name="valueStatement">
            <UTextarea
              v-model="form.valueStatement"
              :disabled="saving"
              :maxlength="10000"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <UFormField label="修改说明" name="reason">
            <UTextarea
              v-model="form.reason"
              :disabled="saving"
              :maxlength="2000"
              :rows="2"
              class="w-full"
            />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :loading="saving">
              保存
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="editing = false"
            >
              取消
            </UButton>
          </div>
        </form>

        <div v-if="editing" class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-medium">
            当前读取内容
          </h3>
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="refreshWorkspace()"
          >
            读取最新内容
          </UButton>
        </div>

        <dl class="divide-y divide-default rounded-lg border border-default px-4">
          <div v-for="field in positioningFields" :key="field.key" class="space-y-2 py-4">
            <dt class="text-sm font-medium">
              {{ field.label }}
            </dt>
            <dd class="whitespace-pre-wrap break-words text-sm text-muted">
              {{ product[field.key] || '尚未填写' }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="advanced-planning-title" class="space-y-3 rounded-lg border border-default p-4">
        <div>
          <h2 id="advanced-planning-title" class="text-base font-semibold">
            高级规划
          </h2>
          <p class="mt-1 text-sm text-muted">
            需要按统一标准比较需求优先级时，可维护评分模型。日常排期直接在版本计划中完成。
          </p>
        </div>
        <UButton
          :to="`/products/${encodeURIComponent(code)}/models`"
          label="评分模型"
          icon="i-lucide-sliders-horizontal"
          color="neutral"
          variant="outline"
        />
      </section>

      <ProductsWorkspaceLifecycle
        v-if="!editing && permissionStatus === 'success'"
        :product-code="product.product_code"
        :revision="product.revision"
        :status="product.status"
        :can-archive="permissions?.archive === true"
        :can-restore="permissions?.restore === true"
        @changed="refreshWorkspace()"
      />

      <ProductsMemberList
        v-if="permissionStatus === 'success' && permissions?.admin === true"
        :key="product.product_code"
        :product-code="product.product_code"
        @changed="refreshAll"
      />
    </template>
  </div>
</template>
