import { defineEventHandler } from 'h3'
import { readEnterpriseProductDocuments } from '../../../../../../../utils/enterpriseProductDocuments'

export default defineEventHandler(event => readEnterpriseProductDocuments(event, 'list'))
