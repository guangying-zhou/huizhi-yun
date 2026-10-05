import { getAllDepartments } from './server/utils/dingtalk'

async function run() {
  console.log('Testing dependencies...')
  try {
    console.log('getAllDepartments type:', typeof getAllDepartments)
  } catch (error) {
    console.error('Test failed:', error)
  }
}

run()
