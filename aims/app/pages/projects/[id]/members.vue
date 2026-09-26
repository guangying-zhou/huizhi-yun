<script setup lang="ts">
import { useAimsModule } from '../../../../layer/useAimsModule'

// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl } = useAimsModule()
const route = useRoute()

await navigateTo(moduleUrl(`/projects/${route.params.id}/settings`), { replace: true })
</script>
