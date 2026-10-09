export default defineEventHandler(async (event) => {
  const snapshot = await loadWebDevPermissionSnapshot(event)

  return {
    code: 0,
    data: snapshot
  }
})
