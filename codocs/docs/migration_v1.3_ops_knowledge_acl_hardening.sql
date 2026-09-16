-- Codocs v1.3: harden historical ops-knowledge context relations.
-- Older deployments wrote the initiating user UID with can_read/can_comment=1.
-- Those rows were business indexes, not sharing grants, and must be disabled
-- before the stable non-user principal is used by the new runtime.

START TRANSACTION;

UPDATE document_relations
SET can_read = 0,
    can_edit = 0,
    can_comment = 0,
    status = 0,
    updated_at = NOW()
WHERE relation_type = 'ops_knowledge'
  AND related_uid <> 'service:altoc:ops-knowledge'
  AND source_type IN (
    'altoc_service_ticket',
    'assets_delivery',
    'assets_delivery_asset',
    'assets_environment',
    'altoc_maintenance_contract',
    'altoc_contract',
    'aims_project',
    'altoc_customer'
  );

UPDATE document_relations
SET can_read = 0,
    can_edit = 0,
    can_comment = 0,
    updated_at = NOW()
WHERE relation_type = 'ops_knowledge'
  AND related_uid = 'service:altoc:ops-knowledge';

COMMIT;

SELECT COUNT(*) AS unsafe_active_ops_knowledge_relations
FROM document_relations
WHERE relation_type = 'ops_knowledge'
  AND status = 1
  AND (can_read <> 0 OR can_edit <> 0 OR can_comment <> 0);
