import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { authenticateRequest } from './auth.js';
import { loadDataRuntimeConfig } from './config.js';
import { FinanceAdapter } from './apps/finance.js';
import { errorResponse, httpError } from './errors.js';
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        }
    });
}
function requestUrl(request) {
    return new URL(request.url);
}
function audit(input) {
    console.info(JSON.stringify({
        ts: new Date().toISOString(),
        requestId: input.requestId,
        tenant: input.auth?.tenant || input.config.tenant,
        deployment: input.auth?.deployment || input.config.deployment,
        appCode: input.auth?.appCode || '',
        subject: input.auth?.subject || '',
        operation: input.operation,
        resource: input.resource,
        durationMs: input.durationMs,
        result: input.status < 400 ? 'ok' : 'error',
        status: input.status,
        errorCode: input.errorCode || ''
    }));
}
export function createDataRuntime(config = loadDataRuntimeConfig()) {
    const finance = config.apps.finance.enabled ? new FinanceAdapter(config.apps.finance.db) : null;
    async function requireAuth(request, required) {
        return await authenticateRequest(request, config, required);
    }
    function requireFinance() {
        if (!finance)
            throw httpError(404, 'finance_adapter_disabled', 'Finance adapter is disabled');
        return finance;
    }
    async function route(request) {
        const url = requestUrl(request);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        if (request.method === 'GET' && path === '/runtime/health') {
            const apps = {};
            if (finance) {
                try {
                    await finance.ping();
                    apps.finance = { enabled: true, db: 'ok' };
                }
                catch (error) {
                    apps.finance = { enabled: true, db: 'unavailable', error: error instanceof Error ? error.message : String(error) };
                }
            }
            else {
                apps.finance = { enabled: false };
            }
            return {
                operation: 'runtime.health',
                body: {
                    status: 'ok',
                    version: '0.1.0',
                    tenant: config.tenant,
                    deployment: config.deployment,
                    apps
                }
            };
        }
        if (request.method === 'GET' && path === '/runtime/enrollment') {
            const auth = await requireAuth(request, { appCode: 'runtime', scope: 'runtime.enrollment.read' });
            return {
                auth,
                operation: 'runtime.enrollment',
                body: {
                    tenant: config.tenant,
                    deployment: config.deployment,
                    authMode: config.auth.mode,
                    apps: {
                        finance: { enabled: Boolean(finance) }
                    }
                }
            };
        }
        if (request.method === 'GET' && path === '/runtime/schema/status') {
            const app = url.searchParams.get('app') || 'finance';
            if (app !== 'finance')
                throw httpError(404, 'app_not_supported', `Unsupported schema status app: ${app}`);
            const auth = await requireAuth(request, { appCode: 'finance', scope: 'finance.schema.read' });
            return {
                auth,
                operation: 'runtime.schema.status',
                body: await requireFinance().schemaStatus()
            };
        }
        if (request.method === 'GET' && path === '/v1/finance/dashboard/summary') {
            const auth = await requireAuth(request, { appCode: 'finance', scope: 'finance.dashboard.read' });
            return {
                auth,
                operation: 'finance.dashboard.summary',
                body: await requireFinance().dashboardSummary()
            };
        }
        if (request.method === 'GET' && path === '/v1/finance/contracts/summaries') {
            const auth = await requireAuth(request, { appCode: 'finance', scope: 'finance.contracts.read' });
            return {
                auth,
                operation: 'finance.contracts.summaries',
                body: await requireFinance().contractSummaries(url)
            };
        }
        if (request.method === 'GET' && path === '/v1/finance/bank-accounts') {
            const auth = await requireAuth(request, { appCode: 'finance', scope: 'finance.bank_accounts.read' });
            return {
                auth,
                operation: 'finance.bank_accounts.list',
                body: await requireFinance().bankAccounts(url)
            };
        }
        throw httpError(404, 'not_found', `No route for ${request.method} ${path}`);
    }
    const server = createServer(async (incoming, outgoing) => {
        const startedAt = Date.now();
        const requestId = incoming.headers['x-request-id']?.toString() || randomUUID();
        const origin = `http://${incoming.headers.host || `${config.server.host}:${config.server.port}`}`;
        const request = new Request(new URL(incoming.url || '/', origin), {
            method: incoming.method,
            headers: incoming.headers,
            body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : incoming,
            duplex: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : 'half'
        });
        let response;
        let operation = 'unknown';
        let auth;
        let errorCode = '';
        try {
            const result = await route(request);
            operation = result.operation;
            auth = result.auth;
            response = jsonResponse(result.body, result.status || 200);
        }
        catch (error) {
            const normalized = errorResponse(error);
            operation = operation === 'unknown' ? 'error' : operation;
            errorCode = normalized.body.error.code;
            response = jsonResponse(normalized.body, normalized.status);
        }
        outgoing.statusCode = response.status;
        outgoing.setHeader('x-request-id', requestId);
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        outgoing.end(await response.text());
        audit({
            requestId,
            config,
            auth,
            operation,
            resource: new URL(request.url).pathname,
            status: response.status,
            durationMs: Date.now() - startedAt,
            errorCode
        });
    });
    return {
        server,
        config,
        stop: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        })
    };
}
export async function startDataRuntime(config = loadDataRuntimeConfig()) {
    const runtime = createDataRuntime(config);
    await new Promise((resolve, reject) => {
        runtime.server.once('error', reject);
        runtime.server.listen(config.server.port, config.server.host, () => {
            runtime.server.off('error', reject);
            resolve();
        });
    });
    console.info(`[hzy-data-runtime] listening on ${config.server.host}:${config.server.port}`);
    return runtime;
}
