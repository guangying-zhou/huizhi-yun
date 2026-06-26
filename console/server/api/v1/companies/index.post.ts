import { createCompany } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const data = await createCompany(await readBody(event))
  return { code: 0, message: '创建成功', data }
})
