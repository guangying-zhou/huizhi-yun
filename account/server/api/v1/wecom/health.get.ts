/**
 * 企业微信服务健康检查
 * GET /api/v1/wecom/health
 *
 * 无需认证，返回服务状态
 */

import { isWecomConfigured } from '~~/server/utils/wecom'

defineRouteMeta({
  openAPI: {
    tags: ['企业微信消息'],
    summary: '企业微信服务健康检查',
    description: '检查企业微信消息服务配置及连通性。无需认证。'
  }
})

export default defineEventHandler(() => {
  return {
    code: 0,
    data: {
      status: 'ok',
      configured: isWecomConfigured(),
      timestamp: new Date().toISOString()
    }
  }
})
