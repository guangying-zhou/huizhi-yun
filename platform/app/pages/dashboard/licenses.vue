<script setup lang="ts">
definePageMeta({
  layout: 'console'
})

// 授权许可（license）由平台依订阅签发，不再面向租户管理员：
// 租户只在订阅/应用页只读查看授权状态，签发/维护在运营端 /admin/licenses。
// 保留本路由仅为兼容旧链接，统一重定向回企业工作台。
await navigateTo('/dashboard', { replace: true })
</script>
