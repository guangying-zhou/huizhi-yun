/**
 * 企业微信可信域名验证文件
 * 路由: GET /WW_verify_cLzQx20CTaflmPf7.txt
 *
 * 注意：此路由通过 nuxt.config.ts 的 routeRules 重写到此处
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'content-type', 'text/plain')
  // 替换为验证文件的实际内容
  return 'cLzQx20CTaflmPf7'
})
