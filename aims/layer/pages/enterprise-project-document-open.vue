<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
type OpenResult={document?:{title?:string},content?:{title?:string,content?:string,updated_at?:string}}
const route=useRoute();const{moduleUrl}=useAimsModule();const projectId=computed(()=>String(route.params.id||''));const documentId=computed(()=>String(route.params.documentId||''));const data=ref<OpenResult|null>(null);const loading=ref(true);const error=ref('')
async function refresh(){loading.value=true;error.value='';try{const r=await $fetch<{code?:number,data?:OpenResult}>(moduleUrl(`/api/v1/projects/${projectId.value}/documents/${documentId.value}/open`));if(r.code!==0||!r.data)throw Error('文档内容暂不可用');data.value=r.data}catch(cause){error.value=cause instanceof Error?cause.message:'文档内容暂不可用'}finally{loading.value=false}}
watch([projectId,documentId],refresh);onMounted(refresh)
</script>
<template><section class="space-y-5"><UButton :to="moduleUrl(`/projects/${projectId}/documents/${documentId}`)" variant="link" color="neutral" icon="i-lucide-arrow-left">返回文档详情</UButton><UAlert v-if="error" color="error" title="无法安全打开文档" :description="error"/><USkeleton v-else-if="loading" class="h-80 w-full"/><template v-else-if="data"><div><h1 class="text-2xl font-semibold text-highlighted">{{ data.content?.title||data.document?.title||'文档内容' }}</h1><p class="text-sm text-muted">{{ data.content?.updated_at||'' }}</p></div><UCard><pre class="whitespace-pre-wrap font-sans text-sm text-default">{{ data.content?.content||'' }}</pre></UCard></template></section></template>
