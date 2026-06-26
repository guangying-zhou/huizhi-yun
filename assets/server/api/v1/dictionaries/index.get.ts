import { ok } from '~~/server/utils/assetsApi'
import { getAllDictionaries } from '~~/server/utils/dictionaryRepository'

export default defineEventHandler(async () => {
  const items = await getAllDictionaries()
  return ok({ items })
})
