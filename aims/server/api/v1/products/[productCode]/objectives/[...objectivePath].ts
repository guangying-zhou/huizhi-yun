import { createError, getRouterParam } from 'h3'
import { handleProductObjective } from '../../../../../utils/productObjectiveRuntime'
import { handleProductItemObjectives } from '../../../../../utils/productItemObjectivesRuntime'
import { productObjectiveRoute } from '../../../../../utils/productObjectiveInput'

export default defineEventHandler((event) => {
  const path = getRouterParam(event, 'objectivePath') || ''
  if (path.startsWith('for-item/')) return handleProductItemObjectives(event, path.slice(9))
  const route = productObjectiveRoute(path, event.method)
  if (!route) throw createError({ statusCode: 404, message: '目标接口不存在' })
  if (!route.methodAllowed) throw createError({ statusCode: 405, message: '目标接口请求方法不允许' })
  return handleProductObjective(event, route.action, route.id)
})
