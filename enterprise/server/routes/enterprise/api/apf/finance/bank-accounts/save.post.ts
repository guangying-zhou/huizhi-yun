import { defineEventHandler } from 'h3'
import { enterpriseAPFUser } from '../../../../../../utils/enterpriseAPF'

export default defineEventHandler(event => enterpriseAPFUser(event, 'finance', 'save'))
