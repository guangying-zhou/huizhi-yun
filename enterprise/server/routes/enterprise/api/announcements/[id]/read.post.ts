import { defineEventHandler } from 'h3'
import { enterpriseAnnouncements } from '../../../../../utils/enterpriseAnnouncements'

export default defineEventHandler(event => enterpriseAnnouncements(event, 'read'))
