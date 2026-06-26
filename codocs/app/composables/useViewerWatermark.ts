interface ViewerAccountUser {
  uid?: string | null
  realName?: string | null
  email?: string | null
  mobile?: string | null
}

interface ViewerAccountUsersResponse {
  items?: ViewerAccountUser[]
  total?: number
}

interface ViewerApiResponse<T> {
  code: number
  message: string
  data: T
}

export function useViewerWatermark() {
  const { user, userEmail, userRealname, userMobileTail } = useAuth()

  const { data: accountUser } = useAsyncData<ViewerAccountUser | null>(
    'viewer-watermark-account-user',
    async () => {
      const uid = String(user.value || '').trim()
      const email = String(userEmail.value || '').trim().toLowerCase()

      if (!uid && !email) return null

      let detailedUser: ViewerAccountUser | null = null

      if (uid) {
        try {
          detailedUser = await $fetch<ViewerAccountUser>('/api/account/user', {
            params: { uid }
          })
        } catch {
          detailedUser = null
        }
      }

      if (detailedUser?.mobile) {
        return detailedUser
      }

      const searchTerms = [uid, email].filter((value, index, array) => value && array.indexOf(value) === index)
      const searchResults = await Promise.all(searchTerms.map(async (search) => {
        try {
          return await $fetch<ViewerApiResponse<ViewerAccountUsersResponse>>('/api/account/users', {
            params: { search }
          })
        } catch {
          return null
        }
      }))

      const items = searchResults.flatMap(result => result?.data?.items || [])
      const matchedUser = items.find((item) => {
        const itemUid = String(item.uid || '').trim()
        const itemEmail = String(item.email || '').trim().toLowerCase()
        return (uid && itemUid === uid) || (email && itemEmail === email)
      })

      if (matchedUser) {
        return {
          ...detailedUser,
          ...matchedUser,
          realName: matchedUser.realName || detailedUser?.realName || null,
          mobile: matchedUser.mobile || detailedUser?.mobile || null
        }
      }

      return detailedUser
    },
    {
      default: () => null,
      watch: [user, userEmail]
    }
  )

  const watermarkText = computed(() => {
    const viewerName = String(
      accountUser.value?.realName
      || userRealname.value
      || user.value
      || accountUser.value?.uid
      || ''
    ).trim()
    if (!viewerName) return ''

    const cachedMobileTail = String(userMobileTail.value || '').trim()
    const mobileDigits = String(accountUser.value?.mobile || '').replace(/\D/g, '')
    const mobileTail = cachedMobileTail || (mobileDigits.length >= 4 ? mobileDigits.slice(-4) : '****')

    return `${viewerName} ${mobileTail}`
  })

  return {
    watermarkText,
    accountUser
  }
}
