-- Candidate only. Requires reviewed installer receipt, unchanged object digests,
-- zero rows, no external FK references, migration lock and stopped Runtime.
-- Never drop a live feedback binding or its receipt/history.
DROP TABLE altoc_product_feedback_progress_projection;
DROP TABLE altoc_product_feedback_status_projection;
DROP TABLE altoc_service_ticket_product_feedback;
