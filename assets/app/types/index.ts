export interface Notification {
  id: number
  unread?: boolean
  sender: {
    name: string
    avatar?: { src: string }
  }
  body: string
  date: string
}

export interface Range {
  start: Date
  end: Date
}

export * from './assets'
