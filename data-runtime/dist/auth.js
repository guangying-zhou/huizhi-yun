import { timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import { httpError } from './errors.js';
let jwksKeySet = null;
let jwksKeySetSource = '';
function bearerToken(request) {
    const header = request.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || '';
}
function secureEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function claimString(payload, keys) {
    for (const key of keys) {
        const value = payload[key];
        if (value !== undefined && value !== null && String(value).trim())
            return String(value).trim();
    }
    return '';
}
function scopeList(payload) {
    const scope = payload.scope;
    if (Array.isArray(scope))
        return scope.map(String);
    return String(scope || '').split(/\s+/).map(item => item.trim()).filter(Boolean);
}
function requireScope(scopes, required) {
    return scopes.includes(required) || scopes.includes('*') || scopes.includes(`${required.split('.')[0]}.*`);
}
function resolveJwks(config) {
    const source = config.auth.jwt.jwksUrl || config.auth.jwt.jwksJson;
    if (jwksKeySet && jwksKeySetSource === source)
        return jwksKeySet;
    if (config.auth.jwt.jwksUrl) {
        jwksKeySet = createRemoteJWKSet(new URL(config.auth.jwt.jwksUrl));
        jwksKeySetSource = source;
        return jwksKeySet;
    }
    if (config.auth.jwt.jwksJson) {
        jwksKeySet = createLocalJWKSet(JSON.parse(config.auth.jwt.jwksJson));
        jwksKeySetSource = source;
        return jwksKeySet;
    }
    throw httpError(503, 'jwks_not_configured', 'Data Runtime JWT auth requires HZY_DATA_RUNTIME_JWKS_URL or HZY_DATA_RUNTIME_JWKS_JSON');
}
export async function authenticateRequest(request, config, required) {
    if (config.auth.mode === 'disabled') {
        return {
            tenant: config.tenant,
            deployment: config.deployment,
            appCode: required.appCode,
            subject: 'dev-disabled-auth',
            scopes: [required.scope],
            mode: 'disabled'
        };
    }
    const token = bearerToken(request);
    if (!token)
        throw httpError(401, 'missing_bearer_token', 'Missing Bearer token');
    if (config.auth.mode === 'static_token') {
        if (!config.auth.staticToken || !secureEqual(token, config.auth.staticToken)) {
            throw httpError(401, 'invalid_static_token', 'Invalid Data Runtime token');
        }
        return {
            tenant: config.tenant,
            deployment: config.deployment,
            appCode: required.appCode,
            subject: 'static-token-client',
            scopes: [required.scope],
            mode: 'static_token'
        };
    }
    const verified = await jwtVerify(token, resolveJwks(config), {
        audience: config.auth.jwt.audience || 'data-runtime',
        issuer: config.auth.jwt.issuer || undefined
    }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        throw httpError(401, 'invalid_jwt', message);
    });
    const payload = verified.payload;
    const tenant = claimString(payload, ['tenant', 'tenant_code', 'tenantCode']);
    const deployment = claimString(payload, ['deployment', 'deployment_code', 'deploymentCode']);
    const appCode = claimString(payload, ['appCode', 'app_code', 'azp', 'client_id']);
    const subject = claimString(payload, ['sub', 'client_id', 'serviceClientId']) || 'unknown';
    const scopes = scopeList(payload);
    if (tenant && tenant !== config.tenant)
        throw httpError(403, 'tenant_mismatch', 'Token tenant is not enrolled on this Agent');
    if (deployment && deployment !== config.deployment)
        throw httpError(403, 'deployment_mismatch', 'Token deployment is not enrolled on this Agent');
    if (appCode && appCode !== required.appCode)
        throw httpError(403, 'app_mismatch', 'Token appCode cannot access this adapter');
    if (!requireScope(scopes, required.scope))
        throw httpError(403, 'insufficient_scope', `Missing scope ${required.scope}`);
    return {
        tenant: tenant || config.tenant,
        deployment: deployment || config.deployment,
        appCode: appCode || required.appCode,
        subject,
        scopes,
        mode: 'jwt'
    };
}
