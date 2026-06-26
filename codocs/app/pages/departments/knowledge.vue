<script setup lang="ts">
import DocumentList from '~/components/document/DocumentList.vue'

definePageMeta({
  layout: 'default'
})

const fetchDeptKnowledge = async () => {
  // TODO: Fetch department knowledge base
  return []
}

const { data: documents, pending } = await useAsyncData('dept-knowledge', fetchDeptKnowledge)
</script>

<template>
  <DocumentList title="部门知识库" :rows="documents || []" :loading="pending" />
</template>
