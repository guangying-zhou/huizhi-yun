CREATE DATABASE  IF NOT EXISTS `codeinsightdb` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `codeinsightdb`;
-- MySQL dump 10.13  Distrib 8.0.34, for macos13 (arm64)
--
-- Host: svn.wiztek.cn    Database: codeinsightdb
-- ------------------------------------------------------
-- Server version	8.0.34

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `event_levels`
--

DROP TABLE IF EXISTS `event_levels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_levels` (
  `id` int NOT NULL AUTO_INCREMENT,
  `level_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `report_levels` int DEFAULT '0' COMMENT '报告层级掩码（1-本人，2-部门经理，4-HR，8-分管领导，16-超级管理员）',
  `notification_methods` int DEFAULT '0' COMMENT '通知方式掩码（1-站内信，2-短信，4-邮件）',
  `is_reply_needed` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `file_type_catalog`
--

DROP TABLE IF EXISTS `file_type_catalog`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `file_type_catalog` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `extension` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `language` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '语言类型',
  `category` enum('code','document','media','ignore','banned','unknown') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown',
  `can_line_count` tinyint(1) NOT NULL DEFAULT '0',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_files` bigint unsigned NOT NULL DEFAULT '0',
  `last_counted_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_extension` (`extension`)
) ENGINE=InnoDB AUTO_INCREMENT=1100 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ingestion_run_logs`
--

DROP TABLE IF EXISTS `ingestion_run_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ingestion_run_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `ingestion_run_id` bigint unsigned NOT NULL COMMENT 'FK to ingestion_runs',
  `log_level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INFO',
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '日志内容',
  `context` json DEFAULT NULL COMMENT '附加上下文',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_run_logs_run` (`ingestion_run_id`,`created_at`),
  CONSTRAINT `fk_run_logs_run` FOREIGN KEY (`ingestion_run_id`) REFERENCES `ingestion_runs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9119 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采集任务日志明细';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ingestion_runs`
--

DROP TABLE IF EXISTS `ingestion_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ingestion_runs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `job_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'catalog_scan/commit_sync 等',
  `source_type` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'svn/gitlab',
  `repo_catalog_id` bigint unsigned DEFAULT NULL COMMENT '关联仓库，可空',
  `repo_key` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '冗余仓库标识',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'pending/running/success/failed',
  `started_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` datetime(6) DEFAULT NULL,
  `items_total` int DEFAULT NULL COMMENT '预期处理数量',
  `items_processed` int DEFAULT NULL COMMENT '已处理数量',
  `items_failed` int DEFAULT NULL COMMENT '失败数量',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误摘要',
  `triggered_by` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '触发来源，如系统/用户',
  `params` json DEFAULT NULL COMMENT '任务参数快照',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_runs_status_time` (`status`,`started_at`),
  KEY `idx_runs_repo` (`repo_catalog_id`,`started_at`),
  CONSTRAINT `fk_run_repo` FOREIGN KEY (`repo_catalog_id`) REFERENCES `repo_catalog` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=827 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据采集任务运行记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `monitoring_event_types`
--

DROP TABLE IF EXISTS `monitoring_event_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `monitoring_event_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `event_level_id` int DEFAULT NULL,
  `monitoring_table` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `eval_formula` text COLLATE utf8mb4_unicode_ci,
  `comparison` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `monitoring_threshold` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message_template` text COLLATE utf8mb4_unicode_ci,
  `coder_only` tinyint(1) DEFAULT '0',
  `is_enabled` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `event_level_id` (`event_level_id`),
  CONSTRAINT `monitoring_event_types_ibfk_1` FOREIGN KEY (`event_level_id`) REFERENCES `event_levels` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `monitoring_events`
--

DROP TABLE IF EXISTS `monitoring_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `monitoring_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `event_type_id` int DEFAULT NULL,
  `org_department_id` int DEFAULT NULL,
  `org_repo_id` int DEFAULT NULL,
  `org_person_id` int DEFAULT NULL,
  `repo_commit_id` bigint DEFAULT NULL,
  `event_level_id` int DEFAULT NULL,
  `monitoring_table` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `eval_formula` text COLLATE utf8mb4_unicode_ci,
  `eval_value` decimal(14,2) NOT NULL DEFAULT '0.00',
  `comparison` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `monitoring_threshold` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `threshold_value` bigint NOT NULL DEFAULT '0',
  `message` text COLLATE utf8mb4_unicode_ci,
  `status` enum('PENDING','SENT','READ','RESOLVED','IGNORED') COLLATE utf8mb4_unicode_ci DEFAULT 'PENDING',
  `sent_at` timestamp NULL DEFAULT NULL,
  `read_at` timestamp NULL DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `event_time` datetime DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `event_type_id` (`event_type_id`),
  KEY `event_level_id` (`event_level_id`),
  KEY `idx_created_person` (`created_at`,`org_person_id`),
  KEY `idx_created_repo` (`created_at`,`org_repo_id`),
  CONSTRAINT `monitoring_events_ibfk_1` FOREIGN KEY (`event_type_id`) REFERENCES `monitoring_event_types` (`id`),
  CONSTRAINT `monitoring_events_ibfk_2` FOREIGN KEY (`event_level_id`) REFERENCES `event_levels` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=322646 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `org_departments`
--

DROP TABLE IF EXISTS `org_departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `org_departments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `parent_id` bigint unsigned DEFAULT NULL COMMENT '父部门 ID，允许为空',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '部门名称',
  `code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '部门编码，选填，组织内唯一',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '部门描述',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否有效',
  `is_external` tinyint NOT NULL DEFAULT '0',
  `manager_user_id` bigint DEFAULT NULL COMMENT '部门负责人（用户表）',
  `leader_user_id` int DEFAULT NULL COMMENT '上级领导',
  `extra` json DEFAULT NULL COMMENT '扩展元数据',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 (服务器时间)',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 (服务器时间)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dept_code` (`code`),
  KEY `idx_dept_parent` (`parent_id`),
  KEY `idx_dept_active` (`is_active`),
  CONSTRAINT `fk_dept_parent` FOREIGN KEY (`parent_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1004 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组织部门';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `org_persons`
--

DROP TABLE IF EXISTS `org_persons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `org_persons` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `parent_id` int DEFAULT NULL COMMENT '关联的父person_id，用于同一个人的不同用户名',
  `username` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SCM username / author_name',
  `real_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '真实姓名 / 姓名',
  `email` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邮箱（唯一，允许空）',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '所属部门',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否在职',
  `is_coder` tinyint(1) NOT NULL DEFAULT '0',
  `language_breakdown` json DEFAULT NULL COMMENT '编程语言分布',
  `extra` json DEFAULT NULL COMMENT '扩展元数据',
  `first_commit_at` datetime(6) DEFAULT NULL COMMENT '首次提交时间',
  `last_commit_at` datetime(6) DEFAULT NULL COMMENT '最后提交时间',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 (服务器时间)',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 (服务器时间)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_person_username` (`username`),
  UNIQUE KEY `uq_person_email` (`email`),
  KEY `idx_person_dept` (`department_id`),
  KEY `idx_person_active` (`is_active`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_person_created_at` (`created_at`),
  KEY `idx_person_first_commit_at` (`first_commit_at`),
  KEY `idx_person_last_commit_at` (`last_commit_at`),
  CONSTRAINT `fk_person_dept` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=214 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组织人员';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_banned_directory_catalog`
--

DROP TABLE IF EXISTS `repo_banned_directory_catalog`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_banned_directory_catalog` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短名/标识，例如 node_modules、tmp',
  `match_type` enum('segment','prefix','glob','regex') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'segment' COMMENT '匹配策略：segment=路径段精确匹配，prefix=前缀，glob=glob 模式，regex=正则',
  `pattern` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '匹配表达式；对于 segment 存短名，对于 prefix 存路径前缀（相对仓库根），glob/regex 存对应模式',
  `repo_catalog_id` bigint unsigned DEFAULT NULL COMMENT '可选：仅对特定仓库生效，NULL 表示全局',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `priority` int NOT NULL DEFAULT '100' COMMENT '匹配优先级，数值越小优先匹配',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name_repo` (`name`,`repo_catalog_id`),
  KEY `idx_repo_catalog` (`repo_catalog_id`),
  KEY `idx_active_priority` (`is_active`,`priority`)
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_catalog`
--

DROP TABLE IF EXISTS `repo_catalog`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_catalog` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `source_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'svn / gitlab',
  `repo_source_id` int unsigned DEFAULT NULL,
  `repo_key` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'source 内唯一标识',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '仓库名称',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '归属部门',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '仓库描述',
  `gitlab_project_id` bigint unsigned DEFAULT NULL COMMENT 'GitLab project ID',
  `repo_path` text COLLATE utf8mb4_unicode_ci COMMENT 'SVN 本地路径',
  `default_branch` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '默认分支',
  `latest_revision` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SVN revision 或 commit SHA',
  `total_commits` bigint unsigned NOT NULL DEFAULT '0' COMMENT '累计提交数',
  `synced_commits` bigint NOT NULL DEFAULT '0',
  `ingested_commits` bigint unsigned NOT NULL DEFAULT '0',
  `is_valid` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否活跃仓库 (1=活跃)',
  `scan_status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending/success/failed',
  `failure_reason` text COLLATE utf8mb4_unicode_ci COMMENT '扫描失败原因',
  `visibility` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'private/public/internal',
  `extra` json DEFAULT NULL COMMENT '扩展元数据',
  `current_commit_year` int DEFAULT NULL COMMENT '当前年度统计对应的年份',
  `current_year_commits` int unsigned NOT NULL DEFAULT '0' COMMENT '当前年度提交数',
  `repo_created_at` datetime(6) DEFAULT NULL COMMENT '源系统仓库创建时间',
  `latest_commit_at` datetime(6) DEFAULT NULL COMMENT '最近提交时间 (UTC)',
  `last_scanned_at` datetime(6) DEFAULT NULL COMMENT '最近扫描时间 (UTC)',
  `repo_events` int NOT NULL DEFAULT '0' COMMENT '仓库异动事件数',
  `commits_events` int NOT NULL DEFAULT '0' COMMENT '提交异动事件数',
  `language_breakdown` json DEFAULT NULL COMMENT '编程语言分布',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 (UTC)',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 (UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_repo_source_key` (`source_type`,`repo_key`),
  KEY `idx_repo_source_scanned` (`source_type`,`last_scanned_at`),
  KEY `idx_repo_scan_status` (`scan_status`),
  KEY `idx_repo_department` (`department_id`),
  KEY `idx_repo_source_id` (`repo_source_id`),
  CONSTRAINT `fk_repo_department` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=265 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库元数据目录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_commit_banned_directories`
--

DROP TABLE IF EXISTS `repo_commit_banned_directories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_commit_banned_directories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `repo_commit_id` bigint unsigned NOT NULL,
  `repo_catalog_id` bigint unsigned DEFAULT NULL,
  `banned_directory_path` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '完整被禁止目录路径（仓库内相对路径）',
  `banned_directory_id` bigint unsigned DEFAULT NULL COMMENT '可选：指向 repo_banned_directory_catalog.id',
  `banned_directory_hash` binary(32) GENERATED ALWAYS AS (unhex(sha2(`banned_directory_path`,256))) STORED NOT NULL,
  `files_unexpected` int unsigned NOT NULL DEFAULT '0',
  `banned_total_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '优先使用 bytes_after 等已有元数据；若缺失则记 0',
  `sample_paths` json DEFAULT NULL COMMENT '示例路径列表(最多若干条)',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_commit_dir` (`repo_commit_id`,`banned_directory_hash`),
  KEY `idx_repo_commit` (`repo_commit_id`),
  KEY `idx_repo_catalog` (`repo_catalog_id`),
  KEY `idx_banned_dir_id` (`banned_directory_id`),
  KEY `idx_banned_dir_hash` (`banned_directory_hash`)
) ENGINE=InnoDB AUTO_INCREMENT=111284 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_commit_diffs`
--

DROP TABLE IF EXISTS `repo_commit_diffs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_commit_diffs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `repo_commit_file_id` bigint unsigned NOT NULL COMMENT 'FK to repo_commit_files',
  `diff_text` mediumtext COLLATE utf8mb4_unicode_ci COMMENT '统一 diff 内容',
  `is_truncated` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'diff 是否因过大或二进制被截断',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_commit_file_diff` (`repo_commit_file_id`),
  CONSTRAINT `fk_commit_diff_file` FOREIGN KEY (`repo_commit_file_id`) REFERENCES `repo_commit_files` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=44 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提交文件 diff 原文';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_commit_files`
--

DROP TABLE IF EXISTS `repo_commit_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_commit_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `repo_catalog_id` bigint DEFAULT NULL COMMENT '仓库ID',
  `repo_commit_id` bigint unsigned NOT NULL COMMENT 'FK to repo_commits',
  `repo_file_id` bigint DEFAULT NULL,
  `file_path` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件路径',
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (substring_index(`file_path`,_utf8mb4'/',-(1))) STORED,
  `file_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown',
  `file_lines` int DEFAULT NULL COMMENT '行数',
  `change_type` char(1) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'A/M/D/R 等',
  `lines_added` int DEFAULT NULL COMMENT '该文件新增行数',
  `lines_deleted` int DEFAULT NULL COMMENT '该文件删除行数',
  `lines_modified` int DEFAULT NULL COMMENT '该文件替换行数',
  `bytes_before` bigint unsigned DEFAULT NULL COMMENT '变更前文件字节数',
  `bytes_after` bigint unsigned DEFAULT NULL COMMENT '变更后文件字节数',
  `content_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '文本文件内容哈希（默认 SHA-256 hex）',
  `is_duplicate` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否重复文件',
  `duplicate_of_file_id` bigint unsigned DEFAULT NULL COMMENT '首次出现的文件ID',
  `duplicate_reason` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '重复判定原因：hash/name_and_size/...',
  `can_line_count` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否二进制文件',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_commit_file` (`repo_commit_id`,`file_path`(255)),
  KEY `idx_file_path` (`file_path`(191)),
  KEY `idx_content_hash` (`content_hash`),
  KEY `idx_is_duplicate` (`is_duplicate`),
  KEY `idx_bytes_after` (`bytes_after`),
  KEY `idx_bin_name_size` (`can_line_count`,`file_name`,`bytes_after`),
  KEY `idx_is_binary` (`can_line_count`),
  KEY `idx_repo_file_id` (`repo_file_id`),
  KEY `idx_name_size` (`file_name`,`bytes_after`),
  KEY `idx_commit_stats` (`repo_commit_id`,`is_duplicate`,`file_type`),
  KEY `idx_rcf_repo_id` (`repo_catalog_id`),
  KEY `idx_rcf_repo_type` (`repo_catalog_id`,`file_type`),
  CONSTRAINT `fk_commit_file_commit` FOREIGN KEY (`repo_commit_id`) REFERENCES `repo_commits` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1062280 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提交文件变更明细';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_commits`
--

DROP TABLE IF EXISTS `repo_commits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_commits` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `repo_catalog_id` bigint unsigned NOT NULL COMMENT 'FK to repo_catalog',
  `source_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'svn/gitlab mirror for denormalized lookup',
  `repo_key` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余字段方便查询',
  `revision` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SVN revision 或 Git commit SHA',
  `parent_revisions` json DEFAULT NULL COMMENT '父提交列表',
  `author_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `author_email` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `committer_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `committer_email` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `committed_at` datetime(6) NOT NULL COMMENT '提交时间 (UTC)',
  `commit_year` int GENERATED ALWAYS AS (year(`committed_at`)) STORED COMMENT '提交年份，用于年度分片',
  `title` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '提交标题',
  `message` mediumtext COLLATE utf8mb4_unicode_ci COMMENT '完整提交说明',
  `raw_metadata` json DEFAULT NULL COMMENT '原始 API 数据',
  `commit_sequence` bigint NOT NULL DEFAULT '0' COMMENT 'Commit sequence number within repository',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int DEFAULT NULL COMMENT '新增文件数',
  `code_files_added` int NOT NULL DEFAULT '0',
  `code_files_deleted` int DEFAULT NULL COMMENT '删除文件数',
  `code_files_modified` int DEFAULT NULL COMMENT '修改文件数',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` int DEFAULT NULL COMMENT '新增行数',
  `lines_deleted` int DEFAULT NULL COMMENT '删除行数',
  `lines_modified` int DEFAULT NULL COMMENT '替换行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '本次提交重复二进制文件大小合计',
  `bytes_added` bigint NOT NULL DEFAULT '0' COMMENT '文件字节增量',
  `binary_bytes_added` bigint DEFAULT NULL,
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `abnormal_events` int NOT NULL DEFAULT '0' COMMENT '异动事件数',
  `is_batch` int NOT NULL DEFAULT '0' COMMENT '是否批量提交',
  `is_invalid` int NOT NULL DEFAULT '0' COMMENT '是否无效提交',
  `score_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '本次提交的文件质量得分',
  `score_code_quality` decimal(5,2) DEFAULT NULL COMMENT '本次提交的代码粒度得分',
  `files_ingested` tinyint(1) NOT NULL DEFAULT '0' COMMENT '文件与去重处理是否完成',
  `ingested_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '入库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_repo_commit_revision` (`repo_catalog_id`,`revision`),
  UNIQUE KEY `uq_repo_commit_sequence` (`repo_catalog_id`,`commit_sequence`),
  KEY `idx_repo_commit_time` (`repo_catalog_id`,`committed_at`),
  KEY `idx_repo_commit_year` (`repo_catalog_id`,`commit_year`),
  KEY `idx_commit_global_order` (`committed_at`,`id`),
  KEY `idx_ingested_committed_at` (`files_ingested`,`committed_at`,`id`),
  KEY `idx_repo_committed_at` (`committed_at`),
  CONSTRAINT `fk_repo_commit_catalog` FOREIGN KEY (`repo_catalog_id`) REFERENCES `repo_catalog` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=145260 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库提交记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_files`
--

DROP TABLE IF EXISTS `repo_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_files` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `repo_catalog_id` int NOT NULL,
  `current_file_path` varchar(1024) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_extension` varchar(50) DEFAULT NULL,
  `file_type` varchar(50) DEFAULT NULL,
  `file_lines` int DEFAULT NULL COMMENT '行数',
  `bytes` bigint DEFAULT NULL COMMENT '文件大小',
  `created_in_commit_id` int NOT NULL,
  `created_time` datetime(6) DEFAULT NULL COMMENT '创建时间',
  `last_modified_in_commit_id` int NOT NULL,
  `updated_time` datetime(6) DEFAULT NULL COMMENT '最后修改时间',
  `deleted_in_commit_id` int DEFAULT NULL,
  `deleted_time` datetime(6) DEFAULT NULL COMMENT '删除时间',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_repo_path` (`repo_catalog_id`,`current_file_path`(255)),
  KEY `idx_repo_catalog_id` (`repo_catalog_id`),
  KEY `idx_created_commit` (`created_in_commit_id`),
  KEY `idx_last_modified_commit` (`last_modified_in_commit_id`),
  KEY `idx_deleted_commit` (`deleted_in_commit_id`),
  KEY `idx_repo_catalog_id_created_time` (`repo_catalog_id`,`created_time`)
) ENGINE=InnoDB AUTO_INCREMENT=986805 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repo_sources`
--

DROP TABLE IF EXISTS `repo_sources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repo_sources` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `source_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '源名称，如 "公司GitLab", "GitHub开源"',
  `source_type` enum('SVN','GIT','GITLAB','GITHUB','GITEE') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '源类型',
  `repos_base` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API基础URL或本地路径，如 http://gitlab.example.com 或 /home/svn',
  `credential_ref` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '凭据引用，指向Config中的属性名，如 GITLAB_TOKEN',
  `sync_enabled` tinyint(1) DEFAULT '1' COMMENT '是否参与自动同步',
  `last_synced_at` datetime(6) DEFAULT NULL COMMENT '最后同步时间',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source_name` (`source_name`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库数据源管理';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat_department_monthly`
--

DROP TABLE IF EXISTS `stat_department_monthly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat_department_monthly` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `department_id` bigint unsigned NOT NULL COMMENT 'FK to org_departments',
  `department_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余部门名称',
  `parent_department_id` bigint unsigned DEFAULT NULL COMMENT '冗余父部门ID',
  `stat_year` int NOT NULL COMMENT '统计年份',
  `stat_month` tinyint NOT NULL COMMENT '统计月份 1-12',
  `work_days` int NOT NULL DEFAULT '0',
  `active_contributors` int unsigned NOT NULL DEFAULT '0' COMMENT '活跃贡献者数',
  `repos_participated` int unsigned NOT NULL DEFAULT '0' COMMENT '参与仓库数',
  `total_commits` int unsigned NOT NULL DEFAULT '0' COMMENT '提交次数',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int unsigned NOT NULL DEFAULT '0' COMMENT '新增文件数',
  `code_files_added` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code_files_deleted` int unsigned NOT NULL DEFAULT '0' COMMENT '删除文件数',
  `code_files_modified` int unsigned NOT NULL DEFAULT '0',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` bigint unsigned NOT NULL DEFAULT '0' COMMENT '新增代码行数',
  `lines_deleted` bigint unsigned NOT NULL DEFAULT '0' COMMENT '删除代码行数',
  `lines_modified` bigint unsigned NOT NULL DEFAULT '0' COMMENT '修改代码行数',
  `total_lines_changed` bigint DEFAULT NULL COMMENT '总变更行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制字节数估计',
  `bytes_added` bigint DEFAULT NULL,
  `binary_bytes_added` bigint DEFAULT '0',
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `computed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `avg_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '平均文件提交质量部门均值',
  `avg_code_quality` decimal(5,2) DEFAULT NULL COMMENT '平均代码提交质量部门均值',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dept_month` (`department_id`,`stat_year`,`stat_month`),
  KEY `idx_dept_time` (`department_id`,`stat_year`,`stat_month`),
  KEY `idx_parent_time` (`parent_department_id`,`stat_year`,`stat_month`),
  KEY `idx_year_month` (`stat_year`,`stat_month`),
  CONSTRAINT `fk_stat_department` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stat_parent_dept` FOREIGN KEY (`parent_department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=507 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门月度提交统计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat_person_daily`
--

DROP TABLE IF EXISTS `stat_person_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat_person_daily` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `person_id` bigint unsigned NOT NULL COMMENT 'FK to org_persons',
  `username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余用户名',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '冗余部门ID',
  `stat_date` date NOT NULL COMMENT '统计日期',
  `repos_participated` int unsigned NOT NULL DEFAULT '0' COMMENT '当日参与仓库数(去重)',
  `commits` int unsigned NOT NULL DEFAULT '0' COMMENT '当日提交数',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int unsigned NOT NULL DEFAULT '0',
  `code_files_added` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code_files_deleted` int unsigned NOT NULL DEFAULT '0' COMMENT '删除文件数',
  `code_files_modified` int unsigned NOT NULL DEFAULT '0',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` bigint unsigned NOT NULL DEFAULT '0',
  `lines_deleted` bigint unsigned NOT NULL DEFAULT '0',
  `lines_modified` bigint unsigned NOT NULL DEFAULT '0',
  `total_lines_changed` bigint DEFAULT NULL COMMENT '总变更行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制字节数估计',
  `bytes_added` bigint DEFAULT NULL,
  `binary_bytes_added` bigint DEFAULT '0',
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `file_type_breakdown` json DEFAULT NULL COMMENT '当日文件类型分布, e.g., {"py": 5, "js": 3}',
  `first_commit_at` datetime(6) DEFAULT NULL,
  `last_commit_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `avg_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '平均文件提交质量',
  `avg_code_quality` decimal(5,2) DEFAULT NULL COMMENT '平均代码提交质量',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_person_date` (`person_id`,`stat_date`),
  KEY `idx_person_time` (`person_id`,`stat_date`),
  KEY `idx_dept_time` (`department_id`,`stat_date`),
  KEY `idx_username` (`username`),
  KEY `idx_stat_date` (`stat_date`),
  CONSTRAINT `fk_pds_dept` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pds_person` FOREIGN KEY (`person_id`) REFERENCES `org_persons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=36452 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员每日统计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat_person_monthly`
--

DROP TABLE IF EXISTS `stat_person_monthly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat_person_monthly` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `person_id` bigint unsigned NOT NULL COMMENT 'FK to org_persons',
  `username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余用户名',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '冗余部门ID（统计时的部门）',
  `stat_year` int NOT NULL COMMENT '统计年份',
  `stat_month` tinyint NOT NULL COMMENT '统计月份 1-12',
  `work_days` int NOT NULL DEFAULT '0',
  `repos_participated` int unsigned NOT NULL DEFAULT '0' COMMENT '参与仓库数（去重）',
  `total_commits` int unsigned NOT NULL DEFAULT '0' COMMENT '提交次数',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int unsigned NOT NULL DEFAULT '0' COMMENT '新增文件数',
  `code_files_added` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code_files_deleted` int unsigned NOT NULL DEFAULT '0' COMMENT '删除文件数',
  `code_files_modified` int unsigned NOT NULL DEFAULT '0',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` bigint unsigned NOT NULL DEFAULT '0' COMMENT '新增代码行数',
  `lines_deleted` bigint unsigned NOT NULL DEFAULT '0' COMMENT '删除代码行数',
  `lines_modified` bigint unsigned NOT NULL DEFAULT '0' COMMENT '修改代码行数',
  `total_lines_changed` bigint DEFAULT NULL COMMENT '总变更行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制字节数估计',
  `bytes_added` bigint DEFAULT NULL,
  `binary_bytes_added` bigint DEFAULT '0',
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `abnormal_events` int NOT NULL DEFAULT '0' COMMENT '异常事件数',
  `first_commit_at` datetime(6) DEFAULT NULL COMMENT '该月首次提交时间',
  `last_commit_at` datetime(6) DEFAULT NULL COMMENT '该月最后提交时间',
  `computed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '统计计算时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `avg_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '平均文件提交质量',
  `avg_code_quality` decimal(5,2) DEFAULT NULL COMMENT '平均代码提交质量',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_person_month` (`person_id`,`stat_year`,`stat_month`),
  KEY `idx_person_time` (`person_id`,`stat_year`,`stat_month`),
  KEY `idx_dept_time` (`department_id`,`stat_year`,`stat_month`),
  KEY `idx_year_month` (`stat_year`,`stat_month`),
  KEY `idx_username` (`username`),
  CONSTRAINT `fk_stat_person` FOREIGN KEY (`person_id`) REFERENCES `org_persons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stat_person_dept` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6479 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员月度提交统计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat_person_repo_daily`
--

DROP TABLE IF EXISTS `stat_person_repo_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat_person_repo_daily` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `person_id` bigint unsigned NOT NULL COMMENT 'FK to org_persons',
  `repo_catalog_id` bigint unsigned NOT NULL COMMENT 'FK to repo_catalog',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '冗余部门ID',
  `stat_date` date NOT NULL COMMENT '统计日期',
  `commits` int unsigned NOT NULL DEFAULT '0',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int unsigned NOT NULL DEFAULT '0',
  `code_files_added` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code_files_deleted` int unsigned NOT NULL DEFAULT '0' COMMENT '删除文件数',
  `code_files_modified` int unsigned NOT NULL DEFAULT '0',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` bigint unsigned NOT NULL DEFAULT '0',
  `lines_deleted` bigint unsigned NOT NULL DEFAULT '0',
  `lines_modified` bigint unsigned NOT NULL DEFAULT '0',
  `total_lines_changed` bigint DEFAULT NULL COMMENT '总变更行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制字节数估计',
  `bytes_added` bigint DEFAULT NULL,
  `binary_bytes_added` bigint DEFAULT '0',
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `first_commit_at` datetime(6) DEFAULT NULL,
  `last_commit_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `avg_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '平均文件提交质量',
  `avg_code_quality` decimal(5,2) DEFAULT NULL COMMENT '平均代码提交质量',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_person_repo_date` (`person_id`,`repo_catalog_id`,`stat_date`),
  KEY `idx_person_time` (`person_id`,`stat_date`),
  KEY `idx_repo_time` (`repo_catalog_id`,`stat_date`),
  KEY `idx_dept_time` (`department_id`,`stat_date`),
  CONSTRAINT `fk_prds_dept` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_prds_person` FOREIGN KEY (`person_id`) REFERENCES `org_persons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_prds_repo` FOREIGN KEY (`repo_catalog_id`) REFERENCES `repo_catalog` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=39379 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员-仓库每日统计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat_person_repo_monthly`
--

DROP TABLE IF EXISTS `stat_person_repo_monthly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat_person_repo_monthly` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `person_id` bigint unsigned NOT NULL COMMENT 'FK to org_persons',
  `repo_catalog_id` bigint unsigned NOT NULL COMMENT 'FK to repo_catalog',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '冗余部门ID',
  `stat_year` int NOT NULL COMMENT '统计年份',
  `stat_month` tinyint NOT NULL COMMENT '统计月份 1-12',
  `work_days` int NOT NULL DEFAULT '0',
  `total_commits` int unsigned NOT NULL DEFAULT '0' COMMENT '该人员在该仓库的提交次数',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int unsigned NOT NULL DEFAULT '0',
  `code_files_added` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code_files_deleted` int unsigned NOT NULL DEFAULT '0' COMMENT '删除文件数',
  `code_files_modified` int unsigned NOT NULL DEFAULT '0',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` bigint unsigned NOT NULL DEFAULT '0',
  `lines_deleted` bigint unsigned NOT NULL DEFAULT '0',
  `lines_modified` bigint unsigned NOT NULL DEFAULT '0',
  `total_lines_changed` bigint DEFAULT NULL COMMENT '总变更行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制字节数估计',
  `bytes_added` bigint DEFAULT NULL,
  `binary_bytes_added` bigint DEFAULT '0',
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `first_commit_at` datetime(6) DEFAULT NULL COMMENT '首次提交时间',
  `last_commit_at` datetime(6) DEFAULT NULL COMMENT '最后提交时间',
  `computed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `avg_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '平均文件提交质量',
  `avg_code_quality` decimal(5,2) DEFAULT NULL COMMENT '平均代码提交质量',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_person_repo_month` (`person_id`,`repo_catalog_id`,`stat_year`,`stat_month`),
  KEY `idx_person_time` (`person_id`,`stat_year`,`stat_month`),
  KEY `idx_repo_time` (`repo_catalog_id`,`stat_year`,`stat_month`),
  KEY `idx_dept_time` (`department_id`,`stat_year`,`stat_month`),
  CONSTRAINT `fk_pr_stat_dept` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pr_stat_person` FOREIGN KEY (`person_id`) REFERENCES `org_persons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pr_stat_repo` FOREIGN KEY (`repo_catalog_id`) REFERENCES `repo_catalog` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7687 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员-仓库月度交叉统计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat_repo_daily`
--

DROP TABLE IF EXISTS `stat_repo_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat_repo_daily` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `repo_catalog_id` bigint unsigned NOT NULL COMMENT 'FK to repo_catalog',
  `stat_date` date NOT NULL COMMENT '统计日期（本地服务器时区）',
  `commits` int unsigned NOT NULL DEFAULT '0' COMMENT '提交次数',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int unsigned DEFAULT '0' COMMENT '新增文件数',
  `code_files_added` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code_files_deleted` int unsigned NOT NULL DEFAULT '0' COMMENT '删除文件数',
  `code_files_modified` int unsigned NOT NULL DEFAULT '0',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` int unsigned DEFAULT '0' COMMENT '新增行数',
  `lines_deleted` int unsigned DEFAULT '0' COMMENT '删除行数',
  `lines_modified` int unsigned DEFAULT '0' COMMENT '替换行数',
  `total_lines_changed` bigint DEFAULT NULL COMMENT '总变更行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制字节数估计',
  `bytes_added` bigint DEFAULT NULL,
  `binary_bytes_added` bigint DEFAULT '0',
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `churn` bigint NOT NULL DEFAULT '0' COMMENT '当日代码波动率 (lines_added + lines_deleted)',
  `file_type_breakdown` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `avg_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '平均文件提交质量',
  `avg_code_quality` decimal(5,2) DEFAULT NULL COMMENT '平均代码提交质量',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_repo_date` (`repo_catalog_id`,`stat_date`),
  KEY `idx_repo_date` (`repo_catalog_id`,`stat_date`),
  CONSTRAINT `fk_daily_repo` FOREIGN KEY (`repo_catalog_id`) REFERENCES `repo_catalog` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=18568 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库每日统计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat_repo_monthly`
--

DROP TABLE IF EXISTS `stat_repo_monthly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat_repo_monthly` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `repo_catalog_id` bigint unsigned NOT NULL COMMENT 'FK to repo_catalog',
  `repo_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余仓库名称',
  `source_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余 svn/gitlab',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '冗余归属部门',
  `stat_year` int NOT NULL COMMENT '统计年份',
  `stat_month` tinyint NOT NULL COMMENT '统计月份 1-12',
  `work_days` int NOT NULL DEFAULT '0',
  `active_contributors` int unsigned NOT NULL DEFAULT '0' COMMENT '活跃贡献者数',
  `total_commits` int unsigned NOT NULL DEFAULT '0' COMMENT '提交次数',
  `directories_banned` int unsigned DEFAULT '0' COMMENT '禁止提交的目录数',
  `files_in_banned_directories` int NOT NULL DEFAULT '0',
  `files_unexpected` int unsigned DEFAULT '0' COMMENT '禁止提交的文件数',
  `files_added` int unsigned NOT NULL DEFAULT '0' COMMENT '新增文件数',
  `code_files_added` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code_files_deleted` int unsigned NOT NULL DEFAULT '0' COMMENT '删除文件数',
  `code_files_modified` int unsigned NOT NULL DEFAULT '0',
  `code_files_duplicated` int NOT NULL DEFAULT '0' COMMENT '本次提交重复的代码(文本)文件数',
  `binary_files_added` bigint DEFAULT NULL,
  `binary_files_deleted` bigint DEFAULT NULL,
  `binary_files_modified` bigint DEFAULT NULL,
  `binary_files_duplicated` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制文件计数',
  `lines_added` bigint unsigned NOT NULL DEFAULT '0' COMMENT '新增代码行数',
  `lines_deleted` bigint unsigned NOT NULL DEFAULT '0' COMMENT '删除代码行数',
  `lines_modified` bigint unsigned NOT NULL DEFAULT '0' COMMENT '修改代码行数',
  `total_lines_changed` bigint DEFAULT NULL COMMENT '总变更行数',
  `unexcepted_files_bytes` bigint DEFAULT NULL,
  `duplicate_files_bytes` bigint unsigned NOT NULL DEFAULT '0' COMMENT '重复的二进制字节数估计',
  `bytes_added` bigint DEFAULT NULL,
  `binary_bytes_added` bigint DEFAULT '0',
  `workload` int NOT NULL DEFAULT '0' COMMENT '工作量',
  `last_day_lines` bigint DEFAULT NULL COMMENT '当月最后行数',
  `commits_events` int NOT NULL DEFAULT '0' COMMENT '提交异常事件数',
  `repo_events` int NOT NULL DEFAULT '0' COMMENT '仓库异常事件数',
  `first_commit_at` datetime(6) DEFAULT NULL COMMENT '该月首次提交时间',
  `last_commit_at` datetime(6) DEFAULT NULL COMMENT '该月最后提交时间',
  `computed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `avg_submission_quality` decimal(5,2) DEFAULT NULL COMMENT '平均文件提交质量',
  `avg_code_quality` decimal(5,2) DEFAULT NULL COMMENT '平均代码提交质量',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_repo_month` (`repo_catalog_id`,`stat_year`,`stat_month`),
  KEY `idx_repo_time` (`repo_catalog_id`,`stat_year`,`stat_month`),
  KEY `idx_dept_time` (`department_id`,`stat_year`,`stat_month`),
  KEY `idx_source_time` (`source_type`,`stat_year`,`stat_month`),
  KEY `idx_year_month` (`stat_year`,`stat_month`),
  CONSTRAINT `fk_stat_repo` FOREIGN KEY (`repo_catalog_id`) REFERENCES `repo_catalog` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stat_repo_dept` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2573 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库月度提交统计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stats_watermarks`
--

DROP TABLE IF EXISTS `stats_watermarks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stats_watermarks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `job_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '统计任务名，例如 repo_daily, repo_monthly',
  `last_commit_id` bigint unsigned DEFAULT NULL COMMENT '已处理到的最大 commit.id（含）',
  `window_days` int unsigned NOT NULL DEFAULT '2' COMMENT '回补时间窗口(天)，用于修正迟到/回滚',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job` (`job_name`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='统计任务水位';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_holidays`
--

DROP TABLE IF EXISTS `system_holidays`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_holidays` (
  `date` date NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '节日名称',
  `is_off_day` tinyint(1) NOT NULL COMMENT '1=休息日, 0=调休工作日',
  `year` int NOT NULL COMMENT '年份',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`date`),
  KEY `idx_year` (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='节假日调休配置';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_parameters`
--

DROP TABLE IF EXISTS `system_parameters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_parameters` (
  `param_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '参数键',
  `param_value` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '参数值',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '说明',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`param_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统参数配置';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_users`
--

DROP TABLE IF EXISTS `system_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_users` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邮箱（唯一标识）',
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '显示名称',
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '密码哈希',
  `umask` int unsigned NOT NULL DEFAULT '0' COMMENT '权限掩码: 1-普通员工，2-部门经理, 4-HR,  8-分管领导, 16-总经理',
  `person_id` bigint unsigned DEFAULT NULL COMMENT '关联贡献者ID',
  `department_id` bigint unsigned DEFAULT NULL COMMENT '所属部门',
  `mobile` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '手机号',
  `status` tinyint NOT NULL DEFAULT '2' COMMENT '状态: 0=禁用, 1=激活, 2=待验证',
  `pu_id` int unsigned DEFAULT NULL COMMENT 'SaaS平台用户ID',
  `verification_code` varchar(6) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '验证码',
  `vc_expired_at` datetime DEFAULT NULL COMMENT '验证码过期时间',
  `latest_logged_at` datetime DEFAULT NULL COMMENT '最近登录时间',
  `login_ip` varchar(39) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '登录IP（支持IPv6）',
  `remark` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_person_id` (`person_id`),
  KEY `idx_department_id` (`department_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_sysuser_dept` FOREIGN KEY (`department_id`) REFERENCES `org_departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_sysuser_person` FOREIGN KEY (`person_id`) REFERENCES `org_persons` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统用户';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `view_department_yearly_stats`
--

DROP TABLE IF EXISTS `view_department_yearly_stats`;
/*!50001 DROP VIEW IF EXISTS `view_department_yearly_stats`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `view_department_yearly_stats` AS SELECT 
 1 AS `department_id`,
 1 AS `department_name`,
 1 AS `parent_department_id`,
 1 AS `stat_year`,
 1 AS `active_months`,
 1 AS `max_contributors`,
 1 AS `total_commits`,
 1 AS `repos_participated_sum`,
 1 AS `files_in_banned_directories`,
 1 AS `directories_banned`,
 1 AS `files_unexpected`,
 1 AS `files_added`,
 1 AS `code_files_added`,
 1 AS `code_files_deleted`,
 1 AS `code_files_modified`,
 1 AS `code_files_duplicated`,
 1 AS `binary_files_added`,
 1 AS `binary_files_deleted`,
 1 AS `binary_files_modified`,
 1 AS `binary_files_duplicated`,
 1 AS `lines_added`,
 1 AS `lines_deleted`,
 1 AS `lines_modified`,
 1 AS `unexcepted_files_bytes`,
 1 AS `duplicate_files_bytes`,
 1 AS `bytes_added`,
 1 AS `binary_bytes_added`,
 1 AS `workload`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `view_person_yearly_stats`
--

DROP TABLE IF EXISTS `view_person_yearly_stats`;
/*!50001 DROP VIEW IF EXISTS `view_person_yearly_stats`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `view_person_yearly_stats` AS SELECT 
 1 AS `person_id`,
 1 AS `username`,
 1 AS `department_id`,
 1 AS `stat_year`,
 1 AS `active_months`,
 1 AS `total_commits`,
 1 AS `repos_participated_sum`,
 1 AS `files_in_banned_directories`,
 1 AS `directories_banned`,
 1 AS `files_unexpected`,
 1 AS `files_added`,
 1 AS `code_files_added`,
 1 AS `code_files_deleted`,
 1 AS `code_files_modified`,
 1 AS `code_files_duplicated`,
 1 AS `binary_files_added`,
 1 AS `binary_files_deleted`,
 1 AS `binary_files_modified`,
 1 AS `binary_files_duplicated`,
 1 AS `lines_added`,
 1 AS `lines_deleted`,
 1 AS `lines_modified`,
 1 AS `unexcepted_files_bytes`,
 1 AS `duplicate_files_bytes`,
 1 AS `bytes_added`,
 1 AS `binary_bytes_added`,
 1 AS `workload`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `view_repo_yearly_stats`
--

DROP TABLE IF EXISTS `view_repo_yearly_stats`;
/*!50001 DROP VIEW IF EXISTS `view_repo_yearly_stats`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `view_repo_yearly_stats` AS SELECT 
 1 AS `repo_catalog_id`,
 1 AS `repo_name`,
 1 AS `source_type`,
 1 AS `department_id`,
 1 AS `stat_year`,
 1 AS `active_months`,
 1 AS `max_contributors`,
 1 AS `total_commits`,
 1 AS `files_in_banned_directories`,
 1 AS `directories_banned`,
 1 AS `files_unexpected`,
 1 AS `files_added`,
 1 AS `code_files_added`,
 1 AS `code_files_deleted`,
 1 AS `code_files_modified`,
 1 AS `code_files_duplicated`,
 1 AS `binary_files_added`,
 1 AS `binary_files_deleted`,
 1 AS `binary_files_modified`,
 1 AS `binary_files_duplicated`,
 1 AS `lines_added`,
 1 AS `lines_deleted`,
 1 AS `lines_modified`,
 1 AS `unexcepted_files_bytes`,
 1 AS `duplicate_files_bytes`,
 1 AS `bytes_added`,
 1 AS `binary_bytes_added`,
 1 AS `first_commit_at`,
 1 AS `last_commit_at`,
 1 AS `workload`*/;
SET character_set_client = @saved_cs_client;

--
-- Final view structure for view `view_department_yearly_stats`
--

/*!50001 DROP VIEW IF EXISTS `view_department_yearly_stats`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `view_department_yearly_stats` AS select `stat_department_monthly`.`department_id` AS `department_id`,`stat_department_monthly`.`department_name` AS `department_name`,`stat_department_monthly`.`parent_department_id` AS `parent_department_id`,`stat_department_monthly`.`stat_year` AS `stat_year`,count(distinct `stat_department_monthly`.`stat_month`) AS `active_months`,max(`stat_department_monthly`.`active_contributors`) AS `max_contributors`,sum(`stat_department_monthly`.`total_commits`) AS `total_commits`,sum(`stat_department_monthly`.`repos_participated`) AS `repos_participated_sum`,sum(`stat_department_monthly`.`files_in_banned_directories`) AS `files_in_banned_directories`,sum(`stat_department_monthly`.`directories_banned`) AS `directories_banned`,sum(`stat_department_monthly`.`files_unexpected`) AS `files_unexpected`,sum(`stat_department_monthly`.`files_added`) AS `files_added`,sum(`stat_department_monthly`.`code_files_added`) AS `code_files_added`,sum(`stat_department_monthly`.`code_files_deleted`) AS `code_files_deleted`,sum(`stat_department_monthly`.`code_files_modified`) AS `code_files_modified`,sum(`stat_department_monthly`.`code_files_duplicated`) AS `code_files_duplicated`,sum(`stat_department_monthly`.`binary_files_added`) AS `binary_files_added`,sum(`stat_department_monthly`.`binary_files_deleted`) AS `binary_files_deleted`,sum(`stat_department_monthly`.`binary_files_modified`) AS `binary_files_modified`,sum(`stat_department_monthly`.`binary_files_duplicated`) AS `binary_files_duplicated`,sum(`stat_department_monthly`.`lines_added`) AS `lines_added`,sum(`stat_department_monthly`.`lines_deleted`) AS `lines_deleted`,sum(`stat_department_monthly`.`lines_modified`) AS `lines_modified`,sum(`stat_department_monthly`.`unexcepted_files_bytes`) AS `unexcepted_files_bytes`,sum(`stat_department_monthly`.`duplicate_files_bytes`) AS `duplicate_files_bytes`,sum(`stat_department_monthly`.`bytes_added`) AS `bytes_added`,sum(`stat_department_monthly`.`binary_bytes_added`) AS `binary_bytes_added`,sum(`stat_department_monthly`.`workload`) AS `workload` from `stat_department_monthly` group by `stat_department_monthly`.`department_id`,`stat_department_monthly`.`department_name`,`stat_department_monthly`.`parent_department_id`,`stat_department_monthly`.`stat_year` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `view_person_yearly_stats`
--

/*!50001 DROP VIEW IF EXISTS `view_person_yearly_stats`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `view_person_yearly_stats` AS select `stat_person_monthly`.`person_id` AS `person_id`,`stat_person_monthly`.`username` AS `username`,`stat_person_monthly`.`department_id` AS `department_id`,`stat_person_monthly`.`stat_year` AS `stat_year`,count(distinct `stat_person_monthly`.`stat_month`) AS `active_months`,sum(`stat_person_monthly`.`total_commits`) AS `total_commits`,sum(`stat_person_monthly`.`repos_participated`) AS `repos_participated_sum`,sum(`stat_person_monthly`.`files_in_banned_directories`) AS `files_in_banned_directories`,sum(`stat_person_monthly`.`directories_banned`) AS `directories_banned`,sum(`stat_person_monthly`.`files_unexpected`) AS `files_unexpected`,sum(`stat_person_monthly`.`files_added`) AS `files_added`,sum(`stat_person_monthly`.`code_files_added`) AS `code_files_added`,sum(`stat_person_monthly`.`code_files_deleted`) AS `code_files_deleted`,sum(`stat_person_monthly`.`code_files_modified`) AS `code_files_modified`,sum(`stat_person_monthly`.`code_files_duplicated`) AS `code_files_duplicated`,sum(`stat_person_monthly`.`binary_files_added`) AS `binary_files_added`,sum(`stat_person_monthly`.`binary_files_deleted`) AS `binary_files_deleted`,sum(`stat_person_monthly`.`binary_files_modified`) AS `binary_files_modified`,sum(`stat_person_monthly`.`binary_files_duplicated`) AS `binary_files_duplicated`,sum(`stat_person_monthly`.`lines_added`) AS `lines_added`,sum(`stat_person_monthly`.`lines_deleted`) AS `lines_deleted`,sum(`stat_person_monthly`.`lines_modified`) AS `lines_modified`,sum(`stat_person_monthly`.`unexcepted_files_bytes`) AS `unexcepted_files_bytes`,sum(`stat_person_monthly`.`duplicate_files_bytes`) AS `duplicate_files_bytes`,sum(`stat_person_monthly`.`bytes_added`) AS `bytes_added`,sum(`stat_person_monthly`.`binary_bytes_added`) AS `binary_bytes_added`,sum(`stat_person_monthly`.`workload`) AS `workload` from `stat_person_monthly` group by `stat_person_monthly`.`person_id`,`stat_person_monthly`.`username`,`stat_person_monthly`.`department_id`,`stat_person_monthly`.`stat_year` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `view_repo_yearly_stats`
--

/*!50001 DROP VIEW IF EXISTS `view_repo_yearly_stats`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `view_repo_yearly_stats` AS select `stat_repo_monthly`.`repo_catalog_id` AS `repo_catalog_id`,`stat_repo_monthly`.`repo_name` AS `repo_name`,`stat_repo_monthly`.`source_type` AS `source_type`,`stat_repo_monthly`.`department_id` AS `department_id`,`stat_repo_monthly`.`stat_year` AS `stat_year`,count(distinct `stat_repo_monthly`.`stat_month`) AS `active_months`,max(`stat_repo_monthly`.`active_contributors`) AS `max_contributors`,sum(`stat_repo_monthly`.`total_commits`) AS `total_commits`,sum(`stat_repo_monthly`.`files_in_banned_directories`) AS `files_in_banned_directories`,sum(`stat_repo_monthly`.`directories_banned`) AS `directories_banned`,sum(`stat_repo_monthly`.`files_unexpected`) AS `files_unexpected`,sum(`stat_repo_monthly`.`files_added`) AS `files_added`,sum(`stat_repo_monthly`.`code_files_added`) AS `code_files_added`,sum(`stat_repo_monthly`.`code_files_deleted`) AS `code_files_deleted`,sum(`stat_repo_monthly`.`code_files_modified`) AS `code_files_modified`,sum(`stat_repo_monthly`.`code_files_duplicated`) AS `code_files_duplicated`,sum(`stat_repo_monthly`.`binary_files_added`) AS `binary_files_added`,sum(`stat_repo_monthly`.`binary_files_deleted`) AS `binary_files_deleted`,sum(`stat_repo_monthly`.`binary_files_modified`) AS `binary_files_modified`,sum(`stat_repo_monthly`.`binary_files_duplicated`) AS `binary_files_duplicated`,sum(`stat_repo_monthly`.`lines_added`) AS `lines_added`,sum(`stat_repo_monthly`.`lines_deleted`) AS `lines_deleted`,sum(`stat_repo_monthly`.`lines_modified`) AS `lines_modified`,sum(`stat_repo_monthly`.`unexcepted_files_bytes`) AS `unexcepted_files_bytes`,sum(`stat_repo_monthly`.`duplicate_files_bytes`) AS `duplicate_files_bytes`,sum(`stat_repo_monthly`.`bytes_added`) AS `bytes_added`,sum(`stat_repo_monthly`.`binary_bytes_added`) AS `binary_bytes_added`,min(`stat_repo_monthly`.`first_commit_at`) AS `first_commit_at`,max(`stat_repo_monthly`.`last_commit_at`) AS `last_commit_at`,sum(`stat_repo_monthly`.`workload`) AS `workload` from `stat_repo_monthly` group by `stat_repo_monthly`.`repo_catalog_id`,`stat_repo_monthly`.`repo_name`,`stat_repo_monthly`.`source_type`,`stat_repo_monthly`.`department_id`,`stat_repo_monthly`.`stat_year` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-12-17 13:42:52
