import { defineEventHandler } from 'h3'
import { consoleAnnouncements } from '../../../../utils/announcementAdmin'

export default defineEventHandler(event => consoleAnnouncements(event, 'surfaces'))
