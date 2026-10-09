-- CANDIDATE ONLY. Separately approve policy/manifest publication, test re-sign,
-- grant installation and production data changes. Never execute with guessed IDs.
-- In the same reviewed session set @announcement_tenant and @console_deployment.
-- NULL defaults cause no writes. Do not revive revoked grants.
START TRANSACTION;
-- No service grants are installed in this wave.
-- Employee announcements:view is configured by Platform baseline permissions.
-- System administrator announcements:admin is configured through the existing role mapping.
INSERT IGNORE INTO console_announcements(tenant_code,announcement_id,title,body_markdown,level,starts_at,audience,show_popup,show_banner,push_bell,push_wecom,created_by,updated_by)
SELECT tenant_code,'a0000000-0000-4000-8000-000000000001','汇智云使用说明（文档与项目）',
 '文档协作、项目任务和工作汇报的日常操作，见[完整使用说明](/enterprise/help)。也可从右上角用户菜单打开「使用说明」。',
 'info',UTC_TIMESTAMP(3),'all',FALSE,FALSE,FALSE,FALSE,'system:announcement-install','system:announcement-install'
FROM org_profiles WHERE singleton_key=1 AND BINARY tenant_code=BINARY @announcement_tenant;
COMMIT;
