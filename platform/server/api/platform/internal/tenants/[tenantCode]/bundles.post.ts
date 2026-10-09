// Internal automation uses the same deterministic bundle generator as the
// operator endpoint. Access is gated by platform-access.ts with the configured
// internal service token before this handler runs.
export { default } from '~~/server/api/platform/_handlers/ops/tenants/[tenantCode]/bundles.post'
