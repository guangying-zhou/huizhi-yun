import mysql from 'mysql2/promise';
export function createDbPool(config) {
    return mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: config.connectionLimit,
        timezone: 'Z',
        dateStrings: true
    });
}
export async function queryRows(pool, sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}
export async function queryRow(pool, sql, params = []) {
    const rows = await queryRows(pool, sql, params);
    return rows[0] || null;
}
