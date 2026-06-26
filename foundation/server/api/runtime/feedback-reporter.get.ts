import { getRuntimeSetting } from '../../utils/runtimeSettings'

/**
 * 解析 Console 系统参数 `feedback.reporter.enabled`，供各应用判断是否展示反馈浮动按钮。
 * 通过 Console service token 读取 runtime settings（带 60s 缓存）；Console 不可达或参数缺失时回退为启用。
 */
export default defineEventHandler(async () => {
  const enabled = await getRuntimeSetting<boolean>('feedback.reporter.enabled', true, { ttlMs: 60000 })
  return { code: 0, data: { enabled: enabled !== false } }
})
