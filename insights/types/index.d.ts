/// <reference types="vite/client" />

declare module '#auth' {
  interface UserSession {
    user: {
      id: string
      name?: string
      displayName?: string
      email: string
      avatarUrl?: string
      picture?: string
      platformRole?: string
      [key: string]: any
    } | null
    loggedIn: boolean
  }
}

// 扩展 Nuxt RuntimeConfig 类型
declare module 'nuxt/schema' {
  interface RuntimeConfig {
    oauth: {
      google: {
        clientId: string | undefined
        clientSecret: string | undefined
      }
    }
    session: {
      maxAge: number
      password: string
    }
    dbUrl?: string
    dbToken?: string
    S3_ENDPOINT?: string
    S3_ACCESS_KEY_ID?: string
    S3_SECRET_ACCESS_KEY?: string
    S3_BUCKET_NAME?: string
    S3_PUBLIC_ACCESS_URL?: string
    encryptionKey?: string
    expectedOrigin: string
    fromEmail?: string
    emailProvider?: string
    paymentProvider?: string
    stripeSecretKey?: string
    storageProvider?: string
    // 新增: 自定义域名 & Cloudflare
    cfApiToken?: string
    cfZoneId?: string
    platformCnameTarget?: string
    internalCronToken?: string
  }
  interface PublicRuntimeConfig {
    siteUrl?: string
    baseDomain?: string
    authHost?: string
    devRootDomains?: string[]
    storageUrl?: string
    persistedState?: any
    stripePublicKey?: string
    stripeProductPrefix?: string
    // 新增: 用于前端展示的 CNAME 目标
    platformCnameTarget?: string
  }
}

export {};

declare module 'h3' {
  interface H3EventContext {
    tenant?: {
      type: 'platform' | 'custom'
      host: string
      subdomain?: string
      businessId?: string
      businessName: string
    }
  }
}
