-- Execute against the configured Altoc database.
SET NAMES utf8mb4;
START TRANSACTION;

DELETE FROM renewal_opportunity
WHERE code = 'DEMO-P3P4-202607-RO';

DELETE FROM service_ticket
WHERE code = 'DEMO-P3P4-202607-ST';

DELETE FROM service_entitlement
WHERE code = 'DEMO-P3P4-202607-SE';

DELETE rel
FROM service_agreement_project_rel rel
INNER JOIN service_agreement sa ON sa.id = rel.service_agreement_id
WHERE sa.code = 'DEMO-P3P4-202607-SA'
  AND rel.project_code = 'DEMO-P3P4-202607-PROJ';

DELETE cov
FROM service_agreement_coverage cov
INNER JOIN service_agreement sa ON sa.id = cov.service_agreement_id
WHERE sa.code = 'DEMO-P3P4-202607-SA'
  AND cov.coverage_code = 'DEMO-P3P4-202607-COV';

DELETE FROM service_agreement
WHERE code = 'DEMO-P3P4-202607-SA';

DELETE FROM maintenance_contract
WHERE code = 'DEMO-P3P4-202607-MC';

DELETE FROM contract_line
WHERE code = 'DEMO-P3P4-202607-CTL';

DELETE FROM contract
WHERE code = 'DEMO-P3P4-202607-CT';

DELETE FROM customer
WHERE code = 'DEMO-P3P4-202607-CUST';

COMMIT;
