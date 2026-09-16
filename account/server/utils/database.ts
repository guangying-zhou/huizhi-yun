import mysql from 'mysql2/promise'

let pool: mysql.Pool | null = null

export function useDatabase() {
  const config = useRuntimeConfig()

  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.name,
      connectionLimit: config.db.connectionLimit,
      waitForConnections: true,
      queueLimit: 0
    })
  }

  return pool
}
