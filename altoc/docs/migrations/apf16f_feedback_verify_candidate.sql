-- Use the reviewed target database only. Candidate, not executed.
SELECT CASE WHEN COUNT(*)=3 THEN 'PASS' ELSE 'FAIL' END AS feedback_tables
FROM information_schema.tables WHERE table_schema=DATABASE()
AND table_name IN ('altoc_service_ticket_product_feedback','altoc_product_feedback_status_projection','altoc_product_feedback_progress_projection') AND table_type='BASE TABLE';
-- Installer must additionally compare every column/index definition and generation.

SELECT CASE WHEN COUNT(*)=7 THEN 'PASS' ELSE 'FAIL' END AS altoc_service_ticket_product_feedback_columns FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='altoc_service_ticket_product_feedback' AND column_name IN ('ticket_id','submission_id','request_biz_id','product_code','operation_id','original_actor_uid','created_at');
SELECT CASE WHEN COUNT(*)=1 THEN 'PASS' ELSE 'FAIL' END AS uk_product_feedback_submission FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='altoc_service_ticket_product_feedback' AND index_name='uk_product_feedback_submission' AND non_unique=0;
SELECT CASE WHEN COUNT(*)=1 THEN 'PASS' ELSE 'FAIL' END AS uk_product_feedback_request FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='altoc_service_ticket_product_feedback' AND index_name='uk_product_feedback_request' AND non_unique=0;
SELECT CASE WHEN COUNT(*)=1 THEN 'PASS' ELSE 'FAIL' END AS uk_product_feedback_operation FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='altoc_service_ticket_product_feedback' AND index_name='uk_product_feedback_operation' AND non_unique=0;

SELECT CASE WHEN COUNT(*)=5 THEN 'PASS' ELSE 'FAIL' END AS altoc_product_feedback_status_projection_columns FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='altoc_product_feedback_status_projection' AND column_name IN ('ticket_id','source_revision','canonical_request_biz_id','decision_status','updated_at');

SELECT CASE WHEN COUNT(*)=4 THEN 'PASS' ELSE 'FAIL' END AS altoc_product_feedback_progress_projection_columns FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='altoc_product_feedback_progress_projection' AND column_name IN ('ticket_id','source_revision','snapshot_json','updated_at');
