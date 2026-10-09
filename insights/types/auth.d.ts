export interface User {
  id: string
  name?: string
  displayName?: string
  email: string
  avatarUrl?: string
  picture?: string
  [key: string]: any
}

export interface UserSession {
  user: User | null
  loggedIn: boolean
}
