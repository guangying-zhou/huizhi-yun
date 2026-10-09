export interface Announcement {
  id: string
  title: string
  body: string
  level: 'info' | 'warning'
  startsAt: string
  endsAt: string
  audience: 'all' | 'departments'
  departments: string[]
  popup: boolean
  banner: boolean
  bell: boolean
  wecom: boolean
  status: 'published' | 'withdrawn'
  revision: number
  read: boolean
  delivery?: { prepared: boolean, pending: number, delivered: number, retrying: number }
}
export interface AnnouncementPage { code: number, data: { items: Announcement[], hasMore: boolean } }
