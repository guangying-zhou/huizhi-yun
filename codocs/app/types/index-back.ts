export interface PersonAvatar {
  src?: string
  alt?: string
  icon?: string
  text?: string
}

export interface MailContact {
  name: string
  email: string
  avatar?: PersonAvatar
}

export interface Mail {
  id: number
  unread?: boolean
  subject: string
  body: string
  date: string
  from: MailContact
}

export interface NotificationSender {
  name: string
  email?: string
  avatar?: PersonAvatar
}

export interface Notification {
  id: number
  unread?: boolean
  body: string
  date: string
  sender: NotificationSender
}
