-- Execute against the configured Aims database.
SET NAMES utf8mb4;
START TRANSACTION;

DELETE ext
FROM work_item_service_ext ext
INNER JOIN aims_projects p ON p.id = ext.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND ext.source_ticket_code = 'DEMO-P3P4-202607-ST';

DELETE te
FROM time_entries te
INNER JOIN aims_projects p ON p.id = te.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND (te.description LIKE 'DEMO-P3P4-202607-TIME-%'
       OR te.uid = 'DEMO-P3P4-202607-EMP');

DELETE w
FROM work_items w
INNER JOIN aims_projects p ON p.id = w.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND (w.template_key = 'altoc:service_ticket:DEMO-P3P4-202607-ST'
       OR w.item_key LIKE 'DEMO-P3P4-202607-%');

DELETE pcs
FROM project_cost_summary pcs
WHERE pcs.project_code = 'DEMO-P3P4-202607-PROJ';

DELETE m
FROM milestones m
INNER JOIN aims_projects p ON p.id = m.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND m.template_key = 'service_ops';

DELETE pm
FROM aims_project_members pm
INNER JOIN aims_projects p ON p.id = pm.project_id
WHERE p.project_code = 'DEMO-P3P4-202607-PROJ'
  AND pm.uid = 'DEMO-P3P4-202607-EMP';

DELETE FROM aims_projects
WHERE project_code = 'DEMO-P3P4-202607-PROJ';

COMMIT;
