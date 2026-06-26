import type { AvatarProps } from '@nuxt/ui'

export type UserStatus = 'subscribed' | 'unsubscribed' | 'bounced'
export type SaleStatus = 'paid' | 'failed' | 'refunded'

export interface Business {
  id: string  // 改为 UUID
  name: string | null
  displayName: string
  fullName: string
  type: string
  language?: 'en' | 'zh'
  logo?: string
  domain?: string
  baseDomain?: string | null
  apiBackend?: string
  apiKey?: string
  backendUrl?: string  // Backend service URL
  status: string
  plan?: string  // 添加plan字段
  creator: {
    id: string  // User ID 已经是 UUID
    name: string
    email: string
    avatar?: string
  }
  membershipRole?: 'OWNER' | 'ADMIN' | 'USER' | null
  createdAt: string
  hasApiKey: boolean
}

export interface User {
  id: string
  name: string
  email: string
  avatarUrl?: string
  status: UserStatus
  location: string
}

export interface UserSession {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: string
  onboarded: boolean
  businessId: string  // 改为 UUID
  avatarUrl?: string
  status: UserStatus
  createdAt: string
  updatedAt: string
  lastActive: string
}

export interface Mail {
  id: number
  unread?: boolean
  from: User
  subject: string
  body: string
  date: string
}

export interface Member {
  name: string
  username: string
  role: 'member' | 'owner'
  avatar: Avatar
}

export interface Stat {
  title: string
  icon: string
  value: number | string
  variation: number
  formatter?: (value: number) => string
}

export interface Sale {
  id: string
  date: string
  status: SaleStatus
  email: string
  amount: number
}

export interface Notification {
  id: number
  unread?: boolean
  sender: User
  body: string
  date: string
}

export type Period = 'daily' | 'weekly' | 'monthly'

export interface Range {
  start: Date
  end: Date
}
