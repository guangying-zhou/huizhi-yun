-- Add score columns to repo_commits
ALTER TABLE repo_commits ADD COLUMN score_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '本次提交的文件质量得分';
ALTER TABLE repo_commits ADD COLUMN score_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '本次提交的代码粒度得分';

-- Add avg columns to stat_repo tables
ALTER TABLE stat_repo_daily ADD COLUMN avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量';
ALTER TABLE stat_repo_daily ADD COLUMN avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量';

ALTER TABLE stat_repo_monthly ADD COLUMN avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量';
ALTER TABLE stat_repo_monthly ADD COLUMN avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量';

-- Add avg columns to stat_person tables
ALTER TABLE stat_person_daily ADD COLUMN avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量';
ALTER TABLE stat_person_daily ADD COLUMN avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量';

ALTER TABLE stat_person_monthly ADD COLUMN avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量';
ALTER TABLE stat_person_monthly ADD COLUMN avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量';

ALTER TABLE stat_person_repo_daily ADD COLUMN avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量';
ALTER TABLE stat_person_repo_daily ADD COLUMN avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量';

ALTER TABLE stat_person_repo_monthly ADD COLUMN avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量';
ALTER TABLE stat_person_repo_monthly ADD COLUMN avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量';

-- Add avg columns to stat_department tables
ALTER TABLE stat_department_monthly ADD COLUMN avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量部门均值';
ALTER TABLE stat_department_monthly ADD COLUMN avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量部门均值';
