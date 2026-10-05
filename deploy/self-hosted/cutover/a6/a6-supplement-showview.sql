-- S4 A6 supplement 1/2 (A15 R3 P0-14, PERMANENT). Reviewed file; apply once as MySQL root, after a6-prod-grants.sql.
-- The Runtime startup check and hzy-enterprise-verify-views read information_schema.VIEWS.VIEW_DEFINITION
-- (internal/enterprise/compatibility_views.go); without SHOW VIEW the definition is invisible and every
-- compatibility view is reported as mismatched. Schema-level only; `_` is escaped so it is a literal underscore.
GRANT SHOW VIEW ON `hzy\_enterprise`.* TO 'hzy_rt_enterprise'@'localhost';
