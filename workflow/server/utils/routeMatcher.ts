/**
 * 路由匹配引擎
 * 根据上下文条件匹配最合适的审批流程路由
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows } from './db'

interface RouteRow extends RowDataPacket {
  id: number
  action_def_id: number
  flow_schema_id: number
  name: string
  description: string | null
  level: number | null
  conditions: string | Record<string, unknown>
  priority: number
  is_default: number
  status: number
}

type ConditionValue
  = | string
    | number
    | { in?: Array<string | number>, not_in?: Array<string | number>, gte?: number, lte?: number, exists?: boolean }

/**
 * 从上下文中获取值，支持点号分隔的路径（如 form_data.amount）
 */
function getContextValue(context: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = context
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * 评估单个条件是否满足
 */
function evaluateCondition(contextValue: unknown, conditionValue: ConditionValue): boolean {
  // 精确匹配（字符串或数字直接比较）
  if (typeof conditionValue === 'string' || typeof conditionValue === 'number') {
    // 支持 initiator_role 为数组的情况（用户可能有多个角色）
    if (Array.isArray(contextValue)) {
      return contextValue.includes(conditionValue)
    }
    return contextValue === conditionValue
  }

  // 对象运算符
  if (typeof conditionValue === 'object' && conditionValue !== null) {
    if ('in' in conditionValue && conditionValue.in) {
      if (Array.isArray(contextValue)) {
        return contextValue.some(v => conditionValue.in!.includes(v))
      }
      return conditionValue.in.includes(contextValue as string | number)
    }

    if ('not_in' in conditionValue && conditionValue.not_in) {
      if (Array.isArray(contextValue)) {
        return !contextValue.some(v => conditionValue.not_in!.includes(v))
      }
      return !conditionValue.not_in.includes(contextValue as string | number)
    }

    if ('gte' in conditionValue && conditionValue.gte !== undefined) {
      return typeof contextValue === 'number' && contextValue >= conditionValue.gte
    }

    if ('lte' in conditionValue && conditionValue.lte !== undefined) {
      return typeof contextValue === 'number' && contextValue <= conditionValue.lte
    }

    if ('exists' in conditionValue) {
      const valueExists = contextValue !== null && contextValue !== undefined && contextValue !== ''
      return conditionValue.exists ? valueExists : !valueExists
    }
  }

  return false
}

/**
 * 评估所有条件是否满足（AND 逻辑）
 */
function evaluateConditions(conditions: Record<string, ConditionValue>, context: Record<string, unknown>): boolean {
  for (const [key, conditionValue] of Object.entries(conditions)) {
    const contextValue = getContextValue(context, key)
    if (!evaluateCondition(contextValue, conditionValue)) {
      return false
    }
  }
  return true
}

/**
 * 匹配路由规则
 *
 * 算法：
 * 1. 查询该动作的所有启用路由，按 priority DESC 排序
 * 2. 如果上下文包含 review_level，优先按 level 精确匹配
 * 3. 否则跳过默认路由，逐一评估 conditions
 * 4. 如果有匹配的路由，取最高优先级的所有匹配项
 * 5. 如果没有匹配的路由，使用默认路由
 * 6. 都没有则抛出错误
 */
export async function matchRoutes(
  actionDefId: number,
  context: Record<string, unknown>
): Promise<RouteRow[]> {
  const routes = await queryRows<RouteRow[]>(
    'SELECT * FROM flow_routes WHERE action_def_id = ? AND status = 1 ORDER BY priority DESC',
    [actionDefId]
  )

  // 优先按 level 精确匹配
  const reviewLevel = context.review_level
  if (reviewLevel !== undefined && reviewLevel !== null) {
    const levelNum = Number(reviewLevel)
    const levelMatched = routes.filter(r => r.level !== null && r.level === levelNum)
    if (levelMatched.length > 0) {
      return levelMatched
    }
  }

  let defaultRoute: RouteRow | null = null
  const matched: RouteRow[] = []

  for (const route of routes) {
    if (route.is_default) {
      defaultRoute = route
      continue
    }

    // 跳过纯 level 路由（已在上面处理过）
    if (route.level !== null) {
      continue
    }

    const conditions = typeof route.conditions === 'string'
      ? JSON.parse(route.conditions)
      : route.conditions

    // 空条件对象不算匹配（空条件应该标记为 is_default）
    if (!conditions || Object.keys(conditions).length === 0) {
      continue
    }

    if (evaluateConditions(conditions, context)) {
      matched.push(route)
    }
  }

  if (matched.length > 0) {
    const maxPriority = matched[0]!.priority
    return matched.filter(r => r.priority === maxPriority)
  }

  if (defaultRoute) {
    return [defaultRoute]
  }

  throw createError({
    statusCode: 400,
    message: '无匹配的审批流程，请联系管理员配置路由规则'
  })
}
