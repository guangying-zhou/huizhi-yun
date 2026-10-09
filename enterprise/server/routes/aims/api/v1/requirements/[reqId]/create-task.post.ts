import { defineEventHandler } from 'h3'
import { enterpriseAimsRequirementWrite } from '../../../../../../utils/enterpriseAimsProjectRequirementWrites'

export default defineEventHandler(event => enterpriseAimsRequirementWrite(event, 'task-create'))
