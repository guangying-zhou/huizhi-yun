SELECT IF(
 (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='aims_milestones' AND column_name='billing_schedule_code' AND data_type='varchar' AND character_maximum_length=64 AND is_nullable='YES')=1
 AND (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='aims_milestones' AND index_name='idx_milestone_billing_schedule' AND column_name='billing_schedule_code' AND seq_in_index=1)=1
 AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='milestones' AND column_name='billing_schedule_code')=1
 AND (SELECT COUNT(*) FROM information_schema.views WHERE table_schema=DATABASE() AND table_name='milestones' AND security_type='INVOKER' AND is_updatable='YES' AND check_option='NONE')=1,
 'PASS','FAIL') AS verify;
