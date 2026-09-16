import { getOpenAPIMeta, renderSwaggerHtml } from '~~/server/utils/openapi'

export default defineEventHandler((event) => {
  const { title, description } = getOpenAPIMeta(event)
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return renderSwaggerHtml('./openapi.json', title, `${description} 仅展示 /api/v1/** 接口。`)
})
