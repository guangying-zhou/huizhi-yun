-- Reviewed tenant-bound runner: deploy/test-env/enterprise-aims-completion-kind.mjs.
-- DDL is non-transactional. Restore the protected backup if interrupted before
-- verification; rerunning the runner is safe after inspecting its fresh plan.
-- The DEFAULT converts every existing request to target without rewriting its
-- frozen snapshot, digest, receipt, operation key, or Workflow binding.
ALTER TABLE `work_item_completion_requests`
  ADD COLUMN `kind` ENUM('target','matter') NOT NULL DEFAULT 'target' AFTER `work_item_id`;
