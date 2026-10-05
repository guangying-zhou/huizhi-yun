import { defineEventHandler } from 'h3'
import { enterpriseHandoffCandidates } from '../../../../../../../utils/enterpriseProductHandoffCandidates'
export default defineEventHandler(event=>enterpriseHandoffCandidates(event,'requirements'))
