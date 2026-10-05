import { ok } from '~~/server/utils/assetsApi'
import { getAllDictionaries } from '~~/server/utils/dictionaryRepository'

export default defineEventHandler(async (event) => {
  const items = await getAllDictionaries(event)
  return ok({ items })
})
