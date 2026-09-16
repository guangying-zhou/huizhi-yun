import { existsSync, readFileSync } from 'node:fs';
function stringValue(value, fallback = '') {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}
function numberValue(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function boolValue(value, fallback) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized)
        return fallback;
    return !['0', 'false', 'no', 'off'].includes(normalized);
}
function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function deepMerge(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const current = result[key];
        result[key] = current && typeof current === 'object' && !Array.isArray(current) && value && typeof value === 'object' && !Array.isArray(value)
            ? deepMerge(current, value)
            : value;
    }
    return result;
}
function loadConfigFile(env) {
    const path = stringValue(env.HZY_DATA_RUNTIME_CONFIG);
    if (!path || !existsSync(path))
        return {};
    return JSON.parse(readFileSync(path, 'utf8'));
}
function normalizeAuthMode(value) {
    if (value === 'jwt' || value === 'static_token' || value === 'disabled')
        return value;
    return 'disabled';
}
export function loadDataRuntimeConfig(env = process.env) {
    const base = {
        server: {
            host: stringValue(env.HZY_DATA_RUNTIME_HOST, '0.0.0.0'),
            port: numberValue(env.HZY_DATA_RUNTIME_PORT, 8080)
        },
        tenant: stringValue(env.HZY_DATA_RUNTIME_TENANT || env.HZY_PLATFORM_TENANT_CODE || env.HZY_TENANT_CODE, 'dev'),
        deployment: stringValue(env.HZY_DATA_RUNTIME_DEPLOYMENT || env.HZY_PLATFORM_DEPLOYMENT_CODE || env.HZY_DEPLOYMENT_CODE, 'dev'),
        auth: {
            mode: normalizeAuthMode(stringValue(env.HZY_DATA_RUNTIME_AUTH_MODE, stringValue(env.HZY_DATA_RUNTIME_STATIC_TOKEN ? 'static_token' : 'disabled'))),
            staticToken: stringValue(env.HZY_DATA_RUNTIME_STATIC_TOKEN),
            jwt: {
                issuer: stringValue(env.HZY_DATA_RUNTIME_JWT_ISSUER),
                audience: stringValue(env.HZY_DATA_RUNTIME_JWT_AUDIENCE, 'data-runtime'),
                jwksUrl: stringValue(env.HZY_DATA_RUNTIME_JWKS_URL),
                jwksJson: stringValue(env.HZY_DATA_RUNTIME_JWKS_JSON)
            }
        },
        apps: {
            finance: {
                enabled: boolValue(env.HZY_FINANCE_AGENT_ENABLED, true),
                db: {
                    host: stringValue(env.HZY_FINANCE_DB_HOST || env.DB_HOST, '127.0.0.1'),
                    port: numberValue(env.HZY_FINANCE_DB_PORT || env.DB_PORT, 3306),
                    user: stringValue(env.HZY_FINANCE_DB_USER || env.DB_USER, 'root'),
                    password: stringValue(env.HZY_FINANCE_DB_PASSWORD || env.DB_PASSWORD),
                    database: stringValue(env.HZY_FINANCE_DB_NAME || env.DB_NAME, 'hzy_finance'),
                    connectionLimit: numberValue(env.HZY_FINANCE_DB_CONNECTION_LIMIT || env.DB_CONNECTION_LIMIT, 5)
                }
            }
        }
    };
    const merged = deepMerge(base, loadConfigFile(env));
    const config = merged;
    config.server = { ...base.server, ...objectValue(config.server) };
    config.auth = { ...base.auth, ...objectValue(config.auth), jwt: { ...base.auth.jwt, ...objectValue(config.auth?.jwt) } };
    config.auth.mode = normalizeAuthMode(String(config.auth.mode || base.auth.mode));
    config.apps = {
        finance: {
            ...base.apps.finance,
            ...objectValue(config.apps?.finance),
            db: {
                ...base.apps.finance.db,
                ...objectValue(config.apps?.finance?.db)
            }
        }
    };
    return config;
}
