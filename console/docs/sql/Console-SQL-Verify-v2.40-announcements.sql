-- Read-only; use the same reviewed tenant/deployment variables as the seed.
SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()
 AND table_name IN ('console_announcements','console_announcement_departments','console_announcement_reads','console_announcement_outbox');
SELECT tenant_code,announcement_id,title,audience,show_popup,show_banner,push_bell,push_wecom,status
FROM console_announcements WHERE tenant_code=@announcement_tenant AND announcement_id='a0000000-0000-4000-8000-000000000001';
SELECT sc.client_code,g.resource_code,g.action,g.status,g.scope_json
FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
WHERE sc.client_code IN ('console.runtime','enterprise.runtime') AND g.resource_code IN
 ('data-runtime:console:announcements','data-runtime:console:scheduler','data-runtime:console:enterprise-host','data-runtime:console:notification','connector-runtime:notifications','notification-runtime');
-- Also verify real token issuance for console:notification:publish and the deployed
-- connector-runtime:notifications:send OR notification-runtime:send scope.
SELECT state,channel,COUNT(*) rows_count,MAX(attempts) max_attempts
FROM console_announcement_outbox WHERE tenant_code=@announcement_tenant GROUP BY state,channel;
