<script setup lang="ts">
import AltocBasicReadPage from '../../../components/AltocBasicReadPage.vue'
definePageMeta({ name: 'altoc-host-customers-detail', navigationOwner: 'altoc', logicalModule: 'altoc', layout: 'enterprise' })
</script>
<template><AltocBasicReadPage resource="customer" title="客户详情" detail /></template>
