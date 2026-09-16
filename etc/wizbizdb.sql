CREATE DATABASE  IF NOT EXISTS `wizbizdb` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `wizbizdb`;
-- MySQL dump 10.13  Distrib 8.0.34, for macos13 (arm64)
--
-- Host: dev.quantics.ca    Database: wizbizdb
-- ------------------------------------------------------
-- Server version	8.0.45

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
-- Table structure for table `gen_table`
--

DROP TABLE IF EXISTS `gen_table`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gen_table` (
  `table_id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `table_name` varchar(200) DEFAULT '' COMMENT '表名称',
  `table_comment` varchar(500) DEFAULT '' COMMENT '表描述',
  `sub_table_name` varchar(64) DEFAULT NULL COMMENT '关联子表的表名',
  `sub_table_fk_name` varchar(64) DEFAULT NULL COMMENT '子表关联的外键名',
  `class_name` varchar(100) DEFAULT '' COMMENT '实体类名称',
  `tpl_category` varchar(200) DEFAULT 'crud' COMMENT '使用的模板（crud单表操作 tree树表操作）',
  `package_name` varchar(100) DEFAULT NULL COMMENT '生成包路径',
  `module_name` varchar(30) DEFAULT NULL COMMENT '生成模块名',
  `business_name` varchar(30) DEFAULT NULL COMMENT '生成业务名',
  `function_name` varchar(50) DEFAULT NULL COMMENT '生成功能名',
  `function_author` varchar(50) DEFAULT NULL COMMENT '生成功能作者',
  `gen_type` char(1) DEFAULT '0' COMMENT '生成代码方式（0zip压缩包 1自定义路径）',
  `gen_path` varchar(200) DEFAULT '/' COMMENT '生成路径（不填默认项目路径）',
  `options` varchar(1000) DEFAULT NULL COMMENT '其它生成选项',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`table_id`)
) ENGINE=InnoDB AUTO_INCREMENT=80 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='代码生成业务表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gen_table_column`
--

DROP TABLE IF EXISTS `gen_table_column`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gen_table_column` (
  `column_id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `table_id` varchar(64) DEFAULT NULL COMMENT '归属表编号',
  `column_name` varchar(200) DEFAULT NULL COMMENT '列名称',
  `column_comment` varchar(500) DEFAULT NULL COMMENT '列描述',
  `column_type` varchar(100) DEFAULT NULL COMMENT '列类型',
  `java_type` varchar(500) DEFAULT NULL COMMENT 'JAVA类型',
  `java_field` varchar(200) DEFAULT NULL COMMENT 'JAVA字段名',
  `is_pk` char(1) DEFAULT NULL COMMENT '是否主键（1是）',
  `is_increment` char(1) DEFAULT NULL COMMENT '是否自增（1是）',
  `is_required` char(1) DEFAULT NULL COMMENT '是否必填（1是）',
  `is_insert` char(1) DEFAULT NULL COMMENT '是否为插入字段（1是）',
  `is_edit` char(1) DEFAULT NULL COMMENT '是否编辑字段（1是）',
  `is_list` char(1) DEFAULT NULL COMMENT '是否列表字段（1是）',
  `is_query` char(1) DEFAULT NULL COMMENT '是否查询字段（1是）',
  `query_type` varchar(200) DEFAULT 'EQ' COMMENT '查询方式（等于、不等于、大于、小于、范围）',
  `html_type` varchar(200) DEFAULT NULL COMMENT '显示类型（文本框、文本域、下拉框、复选框、单选框、日期控件）',
  `dict_type` varchar(200) DEFAULT '' COMMENT '字典类型',
  `sort` int DEFAULT NULL COMMENT '排序',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  PRIMARY KEY (`column_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1156 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='代码生成业务表字段';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_blob_triggers`
--

DROP TABLE IF EXISTS `qrtz_blob_triggers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_blob_triggers` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `trigger_name` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_name的外键',
  `trigger_group` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_group的外键',
  `blob_data` blob COMMENT '存放持久化Trigger对象',
  PRIMARY KEY (`sched_name`,`trigger_name`,`trigger_group`),
  CONSTRAINT `qrtz_blob_triggers_ibfk_1` FOREIGN KEY (`sched_name`, `trigger_name`, `trigger_group`) REFERENCES `qrtz_triggers` (`sched_name`, `trigger_name`, `trigger_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Blob类型的触发器表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_calendars`
--

DROP TABLE IF EXISTS `qrtz_calendars`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_calendars` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `calendar_name` varchar(200) NOT NULL COMMENT '日历名称',
  `calendar` blob NOT NULL COMMENT '存放持久化calendar对象',
  PRIMARY KEY (`sched_name`,`calendar_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='日历信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_cron_triggers`
--

DROP TABLE IF EXISTS `qrtz_cron_triggers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_cron_triggers` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `trigger_name` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_name的外键',
  `trigger_group` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_group的外键',
  `cron_expression` varchar(200) NOT NULL COMMENT 'cron表达式',
  `time_zone_id` varchar(80) DEFAULT NULL COMMENT '时区',
  PRIMARY KEY (`sched_name`,`trigger_name`,`trigger_group`),
  CONSTRAINT `qrtz_cron_triggers_ibfk_1` FOREIGN KEY (`sched_name`, `trigger_name`, `trigger_group`) REFERENCES `qrtz_triggers` (`sched_name`, `trigger_name`, `trigger_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Cron类型的触发器表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_fired_triggers`
--

DROP TABLE IF EXISTS `qrtz_fired_triggers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_fired_triggers` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `entry_id` varchar(95) NOT NULL COMMENT '调度器实例id',
  `trigger_name` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_name的外键',
  `trigger_group` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_group的外键',
  `instance_name` varchar(200) NOT NULL COMMENT '调度器实例名',
  `fired_time` bigint NOT NULL COMMENT '触发的时间',
  `sched_time` bigint NOT NULL COMMENT '定时器制定的时间',
  `priority` int NOT NULL COMMENT '优先级',
  `state` varchar(16) NOT NULL COMMENT '状态',
  `job_name` varchar(200) DEFAULT NULL COMMENT '任务名称',
  `job_group` varchar(200) DEFAULT NULL COMMENT '任务组名',
  `is_nonconcurrent` varchar(1) DEFAULT NULL COMMENT '是否并发',
  `requests_recovery` varchar(1) DEFAULT NULL COMMENT '是否接受恢复执行',
  PRIMARY KEY (`sched_name`,`entry_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='已触发的触发器表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_job_details`
--

DROP TABLE IF EXISTS `qrtz_job_details`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_job_details` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `job_name` varchar(200) NOT NULL COMMENT '任务名称',
  `job_group` varchar(200) NOT NULL COMMENT '任务组名',
  `description` varchar(250) DEFAULT NULL COMMENT '相关介绍',
  `job_class_name` varchar(250) NOT NULL COMMENT '执行任务类名称',
  `is_durable` varchar(1) NOT NULL COMMENT '是否持久化',
  `is_nonconcurrent` varchar(1) NOT NULL COMMENT '是否并发',
  `is_update_data` varchar(1) NOT NULL COMMENT '是否更新数据',
  `requests_recovery` varchar(1) NOT NULL COMMENT '是否接受恢复执行',
  `job_data` blob COMMENT '存放持久化job对象',
  PRIMARY KEY (`sched_name`,`job_name`,`job_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='任务详细信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_locks`
--

DROP TABLE IF EXISTS `qrtz_locks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_locks` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `lock_name` varchar(40) NOT NULL COMMENT '悲观锁名称',
  PRIMARY KEY (`sched_name`,`lock_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='存储的悲观锁信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_paused_trigger_grps`
--

DROP TABLE IF EXISTS `qrtz_paused_trigger_grps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_paused_trigger_grps` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `trigger_group` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_group的外键',
  PRIMARY KEY (`sched_name`,`trigger_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='暂停的触发器表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_scheduler_state`
--

DROP TABLE IF EXISTS `qrtz_scheduler_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_scheduler_state` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `instance_name` varchar(200) NOT NULL COMMENT '实例名称',
  `last_checkin_time` bigint NOT NULL COMMENT '上次检查时间',
  `checkin_interval` bigint NOT NULL COMMENT '检查间隔时间',
  PRIMARY KEY (`sched_name`,`instance_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='调度器状态表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_simple_triggers`
--

DROP TABLE IF EXISTS `qrtz_simple_triggers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_simple_triggers` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `trigger_name` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_name的外键',
  `trigger_group` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_group的外键',
  `repeat_count` bigint NOT NULL COMMENT '重复的次数统计',
  `repeat_interval` bigint NOT NULL COMMENT '重复的间隔时间',
  `times_triggered` bigint NOT NULL COMMENT '已经触发的次数',
  PRIMARY KEY (`sched_name`,`trigger_name`,`trigger_group`),
  CONSTRAINT `qrtz_simple_triggers_ibfk_1` FOREIGN KEY (`sched_name`, `trigger_name`, `trigger_group`) REFERENCES `qrtz_triggers` (`sched_name`, `trigger_name`, `trigger_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='简单触发器的信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_simprop_triggers`
--

DROP TABLE IF EXISTS `qrtz_simprop_triggers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_simprop_triggers` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `trigger_name` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_name的外键',
  `trigger_group` varchar(200) NOT NULL COMMENT 'qrtz_triggers表trigger_group的外键',
  `str_prop_1` varchar(512) DEFAULT NULL COMMENT 'String类型的trigger的第一个参数',
  `str_prop_2` varchar(512) DEFAULT NULL COMMENT 'String类型的trigger的第二个参数',
  `str_prop_3` varchar(512) DEFAULT NULL COMMENT 'String类型的trigger的第三个参数',
  `int_prop_1` int DEFAULT NULL COMMENT 'int类型的trigger的第一个参数',
  `int_prop_2` int DEFAULT NULL COMMENT 'int类型的trigger的第二个参数',
  `long_prop_1` bigint DEFAULT NULL COMMENT 'long类型的trigger的第一个参数',
  `long_prop_2` bigint DEFAULT NULL COMMENT 'long类型的trigger的第二个参数',
  `dec_prop_1` decimal(13,4) DEFAULT NULL COMMENT 'decimal类型的trigger的第一个参数',
  `dec_prop_2` decimal(13,4) DEFAULT NULL COMMENT 'decimal类型的trigger的第二个参数',
  `bool_prop_1` varchar(1) DEFAULT NULL COMMENT 'Boolean类型的trigger的第一个参数',
  `bool_prop_2` varchar(1) DEFAULT NULL COMMENT 'Boolean类型的trigger的第二个参数',
  PRIMARY KEY (`sched_name`,`trigger_name`,`trigger_group`),
  CONSTRAINT `qrtz_simprop_triggers_ibfk_1` FOREIGN KEY (`sched_name`, `trigger_name`, `trigger_group`) REFERENCES `qrtz_triggers` (`sched_name`, `trigger_name`, `trigger_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='同步机制的行锁表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrtz_triggers`
--

DROP TABLE IF EXISTS `qrtz_triggers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrtz_triggers` (
  `sched_name` varchar(120) NOT NULL COMMENT '调度名称',
  `trigger_name` varchar(200) NOT NULL COMMENT '触发器的名字',
  `trigger_group` varchar(200) NOT NULL COMMENT '触发器所属组的名字',
  `job_name` varchar(200) NOT NULL COMMENT 'qrtz_job_details表job_name的外键',
  `job_group` varchar(200) NOT NULL COMMENT 'qrtz_job_details表job_group的外键',
  `description` varchar(250) DEFAULT NULL COMMENT '相关介绍',
  `next_fire_time` bigint DEFAULT NULL COMMENT '上一次触发时间（毫秒）',
  `prev_fire_time` bigint DEFAULT NULL COMMENT '下一次触发时间（默认为-1表示不触发）',
  `priority` int DEFAULT NULL COMMENT '优先级',
  `trigger_state` varchar(16) NOT NULL COMMENT '触发器状态',
  `trigger_type` varchar(8) NOT NULL COMMENT '触发器的类型',
  `start_time` bigint NOT NULL COMMENT '开始时间',
  `end_time` bigint DEFAULT NULL COMMENT '结束时间',
  `calendar_name` varchar(200) DEFAULT NULL COMMENT '日程表名称',
  `misfire_instr` smallint DEFAULT NULL COMMENT '补偿执行的策略',
  `job_data` blob COMMENT '存放持久化job对象',
  PRIMARY KEY (`sched_name`,`trigger_name`,`trigger_group`),
  KEY `sched_name` (`sched_name`,`job_name`,`job_group`),
  CONSTRAINT `qrtz_triggers_ibfk_1` FOREIGN KEY (`sched_name`, `job_name`, `job_group`) REFERENCES `qrtz_job_details` (`sched_name`, `job_name`, `job_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='触发器详细信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_config`
--

DROP TABLE IF EXISTS `sys_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_config` (
  `config_id` int NOT NULL AUTO_INCREMENT COMMENT '参数主键',
  `config_name` varchar(100) DEFAULT '' COMMENT '参数名称',
  `config_key` varchar(100) DEFAULT '' COMMENT '参数键名',
  `config_value` varchar(500) DEFAULT '' COMMENT '参数键值',
  `config_type` char(1) DEFAULT 'N' COMMENT '系统内置（Y是 N否）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`config_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='参数配置表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_dept`
--

DROP TABLE IF EXISTS `sys_dept`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_dept` (
  `dept_id` bigint NOT NULL AUTO_INCREMENT COMMENT '部门id',
  `parent_id` bigint DEFAULT '0' COMMENT '父部门id',
  `ancestors` varchar(50) DEFAULT '' COMMENT '祖级列表',
  `dept_name` varchar(30) DEFAULT '' COMMENT '部门名称',
  `order_num` int DEFAULT '0' COMMENT '显示顺序',
  `leader` bigint DEFAULT NULL COMMENT '负责人',
  `phone` varchar(11) DEFAULT NULL COMMENT '联系电话',
  `email` varchar(50) DEFAULT NULL COMMENT '邮箱',
  `dept_type` char(1) DEFAULT NULL COMMENT '部门类型',
  `status` char(1) DEFAULT '0' COMMENT '部门状态（0正常 1停用）',
  `del_flag` char(1) DEFAULT '0' COMMENT '删除标志（0代表存在 2代表删除）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  PRIMARY KEY (`dept_id`)
) ENGINE=InnoDB AUTO_INCREMENT=133 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='部门表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_dict_data`
--

DROP TABLE IF EXISTS `sys_dict_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_dict_data` (
  `dict_code` bigint NOT NULL AUTO_INCREMENT COMMENT '字典编码',
  `dict_sort` int DEFAULT '0' COMMENT '字典排序',
  `dict_label` varchar(100) DEFAULT '' COMMENT '字典标签',
  `dict_value` varchar(100) DEFAULT '' COMMENT '字典键值',
  `dict_type` varchar(100) DEFAULT '' COMMENT '字典类型',
  `css_class` varchar(100) DEFAULT NULL COMMENT '样式属性（其他样式扩展）',
  `list_class` varchar(100) DEFAULT NULL COMMENT '表格回显样式',
  `is_default` char(1) DEFAULT 'N' COMMENT '是否默认（Y是 N否）',
  `status` char(1) DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`dict_code`)
) ENGINE=InnoDB AUTO_INCREMENT=217 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='字典数据表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_dict_type`
--

DROP TABLE IF EXISTS `sys_dict_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_dict_type` (
  `dict_id` bigint NOT NULL AUTO_INCREMENT COMMENT '字典主键',
  `dict_name` varchar(100) DEFAULT '' COMMENT '字典名称',
  `dict_type` varchar(100) DEFAULT '' COMMENT '字典类型',
  `status` char(1) DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`dict_id`),
  UNIQUE KEY `dict_type` (`dict_type`)
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='字典类型表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_job`
--

DROP TABLE IF EXISTS `sys_job`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_job` (
  `job_id` bigint NOT NULL AUTO_INCREMENT COMMENT '任务ID',
  `job_name` varchar(64) NOT NULL DEFAULT '' COMMENT '任务名称',
  `job_group` varchar(64) NOT NULL DEFAULT 'DEFAULT' COMMENT '任务组名',
  `invoke_target` varchar(500) NOT NULL COMMENT '调用目标字符串',
  `cron_expression` varchar(255) DEFAULT '' COMMENT 'cron执行表达式',
  `misfire_policy` varchar(20) DEFAULT '3' COMMENT '计划执行错误策略（1立即执行 2执行一次 3放弃执行）',
  `concurrent` char(1) DEFAULT '1' COMMENT '是否并发执行（0允许 1禁止）',
  `status` char(1) DEFAULT '0' COMMENT '状态（0正常 1暂停）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT '' COMMENT '备注信息',
  PRIMARY KEY (`job_id`,`job_name`,`job_group`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='定时任务调度表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_job_log`
--

DROP TABLE IF EXISTS `sys_job_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_job_log` (
  `job_log_id` bigint NOT NULL AUTO_INCREMENT COMMENT '任务日志ID',
  `job_name` varchar(64) NOT NULL COMMENT '任务名称',
  `job_group` varchar(64) NOT NULL COMMENT '任务组名',
  `invoke_target` varchar(500) NOT NULL COMMENT '调用目标字符串',
  `job_message` varchar(500) DEFAULT NULL COMMENT '日志信息',
  `status` char(1) DEFAULT '0' COMMENT '执行状态（0正常 1失败）',
  `exception_info` varchar(2000) DEFAULT '' COMMENT '异常信息',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  PRIMARY KEY (`job_log_id`)
) ENGINE=InnoDB AUTO_INCREMENT=92899 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='定时任务调度日志表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_logininfor`
--

DROP TABLE IF EXISTS `sys_logininfor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_logininfor` (
  `info_id` bigint NOT NULL AUTO_INCREMENT COMMENT '访问ID',
  `user_name` varchar(50) DEFAULT '' COMMENT '用户账号',
  `ipaddr` varchar(128) DEFAULT '' COMMENT '登录IP地址',
  `login_location` varchar(255) DEFAULT '' COMMENT '登录地点',
  `browser` varchar(50) DEFAULT '' COMMENT '浏览器类型',
  `os` varchar(50) DEFAULT '' COMMENT '操作系统',
  `status` char(1) DEFAULT '0' COMMENT '登录状态（0成功 1失败）',
  `msg` varchar(255) DEFAULT '' COMMENT '提示消息',
  `login_time` datetime DEFAULT NULL COMMENT '访问时间',
  PRIMARY KEY (`info_id`)
) ENGINE=InnoDB AUTO_INCREMENT=536 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统访问记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_menu`
--

DROP TABLE IF EXISTS `sys_menu`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_menu` (
  `menu_id` bigint NOT NULL AUTO_INCREMENT COMMENT '菜单ID',
  `menu_name` varchar(50) NOT NULL COMMENT '菜单名称',
  `parent_id` bigint DEFAULT '0' COMMENT '父菜单ID',
  `order_num` int DEFAULT '0' COMMENT '显示顺序',
  `path` varchar(200) DEFAULT '' COMMENT '路由地址',
  `component` varchar(255) DEFAULT NULL COMMENT '组件路径',
  `query` varchar(255) DEFAULT NULL COMMENT '路由参数',
  `is_frame` int DEFAULT '1' COMMENT '是否为外链（0是 1否）',
  `is_cache` int DEFAULT '0' COMMENT '是否缓存（0缓存 1不缓存）',
  `menu_type` char(1) DEFAULT '' COMMENT '菜单类型（M目录 C菜单 F按钮）',
  `visible` char(1) DEFAULT '0' COMMENT '菜单状态（0显示 1隐藏）',
  `status` char(1) DEFAULT '0' COMMENT '菜单状态（0正常 1停用）',
  `perms` varchar(100) DEFAULT NULL COMMENT '权限标识',
  `icon` varchar(100) DEFAULT '#' COMMENT '菜单图标',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT '' COMMENT '备注',
  PRIMARY KEY (`menu_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1309 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='菜单权限表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_notice`
--

DROP TABLE IF EXISTS `sys_notice`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_notice` (
  `notice_id` int NOT NULL AUTO_INCREMENT COMMENT '公告ID',
  `notice_title` varchar(50) NOT NULL COMMENT '公告标题',
  `notice_type` char(1) NOT NULL COMMENT '公告类型（1通知 2公告）',
  `notice_content` longblob COMMENT '公告内容',
  `status` char(1) DEFAULT '0' COMMENT '公告状态（0正常 1关闭）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(255) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`notice_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知公告表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_oper_log`
--

DROP TABLE IF EXISTS `sys_oper_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_oper_log` (
  `oper_id` bigint NOT NULL AUTO_INCREMENT COMMENT '日志主键',
  `title` varchar(50) DEFAULT '' COMMENT '模块标题',
  `business_type` int DEFAULT '0' COMMENT '业务类型（0其它 1新增 2修改 3删除）',
  `method` varchar(100) DEFAULT '' COMMENT '方法名称',
  `request_method` varchar(10) DEFAULT '' COMMENT '请求方式',
  `operator_type` int DEFAULT '0' COMMENT '操作类别（0其它 1后台用户 2手机端用户）',
  `oper_name` varchar(50) DEFAULT '' COMMENT '操作人员',
  `dept_name` varchar(50) DEFAULT '' COMMENT '部门名称',
  `oper_url` varchar(255) DEFAULT '' COMMENT '请求URL',
  `oper_ip` varchar(128) DEFAULT '' COMMENT '主机地址',
  `oper_location` varchar(255) DEFAULT '' COMMENT '操作地点',
  `oper_param` varchar(2000) DEFAULT '' COMMENT '请求参数',
  `json_result` varchar(2000) DEFAULT '' COMMENT '返回参数',
  `status` int DEFAULT '0' COMMENT '操作状态（0正常 1异常）',
  `error_msg` varchar(2000) DEFAULT '' COMMENT '错误消息',
  `oper_time` datetime DEFAULT NULL COMMENT '操作时间',
  `cost_time` bigint DEFAULT '0' COMMENT '消耗时间',
  PRIMARY KEY (`oper_id`)
) ENGINE=InnoDB AUTO_INCREMENT=42642 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='操作日志记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_role`
--

DROP TABLE IF EXISTS `sys_role`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_role` (
  `role_id` bigint NOT NULL AUTO_INCREMENT COMMENT '角色ID',
  `role_name` varchar(30) NOT NULL COMMENT '角色名称',
  `role_key` varchar(100) NOT NULL COMMENT '角色权限字符串',
  `role_sort` int NOT NULL COMMENT '显示顺序',
  `data_scope` char(1) DEFAULT '1' COMMENT '数据范围（1：全部数据权限 2：自定数据权限 3：本部门数据权限 4：本部门及以下数据权限）',
  `menu_check_strictly` tinyint(1) DEFAULT '1' COMMENT '菜单树选择项是否关联显示',
  `dept_check_strictly` tinyint(1) DEFAULT '1' COMMENT '部门树选择项是否关联显示',
  `status` char(1) NOT NULL COMMENT '角色状态（0正常 1停用）',
  `del_flag` char(1) DEFAULT '0' COMMENT '删除标志（0代表存在 2代表删除）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`role_id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_role_dept`
--

DROP TABLE IF EXISTS `sys_role_dept`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_role_dept` (
  `role_id` bigint NOT NULL COMMENT '角色ID',
  `dept_id` bigint NOT NULL COMMENT '部门ID',
  PRIMARY KEY (`role_id`,`dept_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色和部门关联表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_role_menu`
--

DROP TABLE IF EXISTS `sys_role_menu`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_role_menu` (
  `role_id` bigint NOT NULL COMMENT '角色ID',
  `menu_id` bigint NOT NULL COMMENT '菜单ID',
  PRIMARY KEY (`role_id`,`menu_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色和菜单关联表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_user`
--

DROP TABLE IF EXISTS `sys_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_user` (
  `user_id` bigint NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `dept_id` bigint DEFAULT NULL COMMENT '部门ID',
  `user_name` varchar(30) NOT NULL COMMENT '用户账号',
  `nick_name` varchar(30) NOT NULL COMMENT '用户昵称',
  `user_type` varchar(2) DEFAULT '00' COMMENT '用户类型（00系统用户）',
  `email` varchar(50) DEFAULT '' COMMENT '用户邮箱',
  `phonenumber` varchar(11) DEFAULT '' COMMENT '手机号码',
  `sex` char(1) DEFAULT '0' COMMENT '用户性别（0男 1女 2未知）',
  `avatar` varchar(100) DEFAULT '' COMMENT '头像地址',
  `password` varchar(100) DEFAULT '' COMMENT '密码',
  `status` char(1) DEFAULT '0' COMMENT '帐号状态（0正常 1停用）',
  `del_flag` char(1) DEFAULT '0' COMMENT '删除标志（0代表存在 2代表删除）',
  `login_ip` varchar(128) DEFAULT '' COMMENT '最后登录IP',
  `login_date` datetime DEFAULT NULL COMMENT '最后登录时间',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_user_post`
--

DROP TABLE IF EXISTS `sys_user_post`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_user_post` (
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `post_id` bigint NOT NULL COMMENT '岗位ID',
  PRIMARY KEY (`user_id`,`post_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户与岗位关联表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sys_user_role`
--

DROP TABLE IF EXISTS `sys_user_role`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sys_user_role` (
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `role_id` bigint NOT NULL COMMENT '角色ID',
  PRIMARY KEY (`user_id`,`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户和角色关联表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_account_balance`
--

DROP TABLE IF EXISTS `wb_account_balance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_account_balance` (
  `ab_id` bigint NOT NULL AUTO_INCREMENT COMMENT '银行账户余额ID',
  `ba_id` bigint NOT NULL COMMENT '银行账户ID',
  `check_date` date NOT NULL COMMENT '对账日期',
  `balance` decimal(12,2) NOT NULL COMMENT '余额',
  `remark` varchar(255) DEFAULT NULL COMMENT '备注',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`ab_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6635 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='银行账户余额表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_annual_contribution`
--

DROP TABLE IF EXISTS `wb_annual_contribution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_annual_contribution` (
  `ac_id` bigint NOT NULL AUTO_INCREMENT COMMENT '年度贡献ID',
  `employee_id` bigint NOT NULL COMMENT '员工ID',
  `dept_id` bigint DEFAULT NULL COMMENT '部门ID',
  `project_id` bigint DEFAULT NULL COMMENT '项目ID',
  `work_year` varchar(4) NOT NULL COMMENT '年份',
  `work_hours` decimal(8,2) DEFAULT NULL COMMENT '工时',
  `work_ratio` int DEFAULT NULL COMMENT '工时占比',
  `contrib_ratio` int DEFAULT NULL COMMENT '贡献占比',
  `work_value` decimal(10,2) DEFAULT NULL COMMENT '贡献值',
  `description` varchar(255) DEFAULT NULL COMMENT '说明',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`ac_id`)
) ENGINE=InnoDB AUTO_INCREMENT=239 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='年度贡献表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_archives`
--

DROP TABLE IF EXISTS `wb_archives`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_archives` (
  `archives_id` varchar(36) NOT NULL COMMENT '档案ID',
  `archives_code` varchar(20) DEFAULT NULL COMMENT '档案编码',
  `archives_type` varchar(20) NOT NULL COMMENT '档案类型',
  `archives_name` varchar(100) NOT NULL COMMENT '名称',
  `position` varchar(100) DEFAULT NULL COMMENT '存放位置',
  `level` char(1) DEFAULT '0' COMMENT '密级',
  `start_date` date DEFAULT NULL COMMENT '建档日期',
  `end_date` date DEFAULT NULL COMMENT '归档日期',
  `description` varchar(255) DEFAULT NULL COMMENT '描述',
  `archives_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1删除 2归档 3封存）',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`archives_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='档案表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_archives_list`
--

DROP TABLE IF EXISTS `wb_archives_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_archives_list` (
  `al_id` bigint NOT NULL AUTO_INCREMENT COMMENT '档案模板ID',
  `archives_type` varchar(20) NOT NULL COMMENT '档案类型',
  `al_order` int DEFAULT NULL COMMENT '序号',
  `al_name` varchar(20) DEFAULT NULL COMMENT '档案名称',
  PRIMARY KEY (`al_id`)
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='档案模板表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_archives_page`
--

DROP TABLE IF EXISTS `wb_archives_page`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_archives_page` (
  `ap_id` varchar(36) NOT NULL COMMENT '档案页ID',
  `archives_id` varchar(36) NOT NULL COMMENT '档案ID',
  `ap_order` int DEFAULT NULL COMMENT '序号',
  `ap_type` varchar(20) DEFAULT NULL COMMENT '文件类型',
  `ap_name` varchar(20) DEFAULT NULL COMMENT '名称',
  `ap_url` varchar(255) DEFAULT NULL COMMENT 'URL',
  `submit_date` datetime DEFAULT NULL COMMENT '提交日期',
  `description` varchar(255) DEFAULT NULL COMMENT '描述',
  `ap_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1删除 2归档 3封存）',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`ap_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='档案页表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_archives_page_copy1`
--

DROP TABLE IF EXISTS `wb_archives_page_copy1`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_archives_page_copy1` (
  `ap_id` varchar(36) NOT NULL COMMENT '档案页ID',
  `archives_id` varchar(36) NOT NULL COMMENT '档案ID',
  `ap_order` int DEFAULT NULL COMMENT '序号',
  `ap_type` varchar(20) DEFAULT NULL COMMENT '文件类型',
  `ap_name` varchar(20) DEFAULT NULL COMMENT '名称',
  `ap_url` varchar(255) DEFAULT NULL COMMENT 'URL',
  `submit_date` datetime DEFAULT NULL COMMENT '提交日期',
  `description` varchar(255) DEFAULT NULL COMMENT '描述',
  `ap_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1删除 2归档 3封存）',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`ap_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='档案页表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_attendance`
--

DROP TABLE IF EXISTS `wb_attendance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_attendance` (
  `attendance_id` bigint NOT NULL AUTO_INCREMENT COMMENT '月度考勤ID',
  `employee_id` bigint NOT NULL COMMENT '员工ID',
  `att_month` varchar(7) NOT NULL COMMENT '考勤月份',
  `employee_name` varchar(50) NOT NULL COMMENT '姓名',
  `ding_id` varchar(30) DEFAULT NULL COMMENT '钉钉ID',
  `att_group` varchar(30) DEFAULT NULL COMMENT '考勤组',
  `duty_days` int DEFAULT NULL COMMENT '应出勤天数',
  `att_days` decimal(8,2) DEFAULT NULL COMMENT '出勤天数',
  `lieu_leave` decimal(8,2) DEFAULT NULL COMMENT '调休天数',
  `lieu_balance` decimal(8,2) DEFAULT NULL COMMENT '调休剩余天数',
  `general_leave` decimal(8,2) DEFAULT NULL COMMENT '年假天数',
  `general_balance` decimal(8,2) DEFAULT NULL COMMENT '年假剩余天数',
  `business_leave` decimal(8,2) DEFAULT NULL COMMENT '事假天数',
  `sick_leave` decimal(8,2) DEFAULT NULL COMMENT '病假天数',
  `marriage_leave` decimal(8,2) DEFAULT NULL COMMENT '婚假天数',
  `funeral_leave` decimal(8,2) DEFAULT NULL COMMENT '丧假天数',
  `maternity_leave` decimal(8,2) DEFAULT NULL COMMENT '（陪）产假天数',
  `overtime` decimal(8,2) DEFAULT NULL COMMENT '加班时长',
  `lateness` int DEFAULT NULL COMMENT '迟到天数',
  `late_time` decimal(8,2) DEFAULT NULL COMMENT '迟到时长',
  `ex_lateness` int DEFAULT NULL COMMENT '严重迟到天数',
  `ex_late_time` decimal(8,2) DEFAULT NULL COMMENT '严重迟到时长',
  `leave_early` int DEFAULT NULL COMMENT '早退天数',
  `leave_early_time` decimal(8,2) DEFAULT NULL COMMENT '早退时长',
  `att_detail` varchar(500) DEFAULT NULL COMMENT '考勤详细',
  `pa_level` char(1) DEFAULT 'B' COMMENT '考核等级',
  `hr_cost` decimal(8,2) DEFAULT '0.00' COMMENT '人力成本',
  `projects` int DEFAULT NULL COMMENT '参与项目数',
  `report_projects` int DEFAULT NULL COMMENT '填报项目数',
  `work_hours` decimal(8,2) DEFAULT NULL COMMENT '工时数',
  `ratio` decimal(8,2) DEFAULT NULL COMMENT '填报比例',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0未提交 1已提交 2已应用）',
  `operator_id` bigint DEFAULT NULL COMMENT '操作人ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`attendance_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8033 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='月度考勤表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_bank_account`
--

DROP TABLE IF EXISTS `wb_bank_account`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_bank_account` (
  `ba_id` bigint NOT NULL AUTO_INCREMENT COMMENT '银行账户ID',
  `org_id` bigint NOT NULL COMMENT '机构ID',
  `short_name` varchar(20) NOT NULL COMMENT '简称',
  `account_name` varchar(255) NOT NULL COMMENT '户名',
  `account_sn` bigint DEFAULT NULL COMMENT '账户序号',
  `account_number` varchar(30) NOT NULL COMMENT '账号',
  `bank_code` varchar(30) DEFAULT NULL COMMENT '银行行号',
  `bank_name` varchar(255) NOT NULL COMMENT '银行名称',
  `ba_type` char(1) NOT NULL COMMENT '账户类型(wb_account_type)',
  `ba_status` char(1) NOT NULL COMMENT '账户状态(wb_record_status)',
  `create_time` date DEFAULT NULL COMMENT '开户日期',
  `check_date` date DEFAULT NULL COMMENT '对账日期',
  `balance` decimal(12,2) DEFAULT NULL COMMENT '余额',
  `remark` varchar(255) DEFAULT NULL COMMENT '银行账号备注',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`ba_id`),
  UNIQUE KEY `account_number_UNIQUE` (`account_number`),
  UNIQUE KEY `short_name_UNIQUE` (`short_name`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='银行账户表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_career`
--

DROP TABLE IF EXISTS `wb_career`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_career` (
  `career_id` bigint NOT NULL AUTO_INCREMENT COMMENT '职业生涯ID',
  `employee_id` bigint NOT NULL COMMENT '员工ID',
  `event_date` date DEFAULT NULL COMMENT '日期',
  `end_date` date DEFAULT NULL COMMENT '结束日期',
  `event_type` char(2) NOT NULL COMMENT '事件类型（0入职 1合同 2任命 3调升 4奖励 5免职 6调降 7惩罚 8辞退 9离职）',
  `old_rank` varchar(6) DEFAULT NULL COMMENT '原职级',
  `new_rank` varchar(6) DEFAULT NULL COMMENT '新职级',
  `old_salary` decimal(8,2) DEFAULT NULL COMMENT '原职级工资',
  `new_salary` decimal(8,2) DEFAULT NULL COMMENT '新职级工资',
  `times` int DEFAULT NULL COMMENT '次数',
  `amount` decimal(8,2) DEFAULT NULL COMMENT '奖惩额度',
  `description` varchar(255) NOT NULL COMMENT '描述',
  `company_id` bigint DEFAULT NULL COMMENT '公司ID',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`career_id`)
) ENGINE=InnoDB AUTO_INCREMENT=870 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='职业生涯表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_contact_message`
--

DROP TABLE IF EXISTS `wb_contact_message`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_contact_message` (
  `message_id` bigint NOT NULL AUTO_INCREMENT COMMENT '留言ID',
  `category` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '问题类型',
  `content` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '角色名称',
  `company` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '单位名称',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '联系人姓名',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '联系电话',
  `email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '电子邮箱',
  `status` tinyint DEFAULT '0' COMMENT '处理状态：0-未处理，1-处理中，2-已处理',
  `ip_address` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '提交IP',
  `os` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '系统',
  `browser` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '浏览器',
  `del_flag` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '0' COMMENT '删除标志（0代表存在 2代表删除）',
  `create_by` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`message_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=44 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='联系信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_contactman`
--

DROP TABLE IF EXISTS `wb_contactman`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_contactman` (
  `contactman_id` bigint NOT NULL AUTO_INCREMENT COMMENT '联系人ID',
  `org_id` bigint DEFAULT NULL COMMENT '组织ID',
  `cm_name` varchar(255) NOT NULL COMMENT '姓名',
  `department` varchar(50) DEFAULT NULL COMMENT '部门',
  `post` varchar(20) DEFAULT NULL COMMENT '职务',
  `phone` varchar(255) DEFAULT NULL COMMENT '办公电话',
  `mobile` varchar(255) DEFAULT NULL COMMENT '手机号码',
  `mobile2` varchar(255) DEFAULT NULL COMMENT '备用手机号码',
  `address` varchar(255) DEFAULT NULL COMMENT '快递信息',
  `weixin_number` varchar(255) DEFAULT NULL COMMENT '微信号',
  `stars` int DEFAULT '3' COMMENT '星级（1-2星，2-3星，3-3.5星，4-4星，5-4.5星，6-5星）',
  `chief` char(1) DEFAULT '0',
  `remarks` varchar(255) DEFAULT NULL COMMENT '备注',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `employee_id` bigint NOT NULL COMMENT '业务员ID',
  `operator_id` bigint NOT NULL COMMENT '用户ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`contactman_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1928 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='联系人表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_contactman_info`
--

DROP TABLE IF EXISTS `wb_contactman_info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_contactman_info` (
  `contactman_info_id` bigint NOT NULL AUTO_INCREMENT COMMENT '联系人信息ID',
  `contactman_id` bigint NOT NULL COMMENT '联系人ID',
  `org_id` bigint DEFAULT NULL COMMENT '组织ID',
  `cm_name` varchar(255) NOT NULL COMMENT '姓名',
  `post` varchar(20) DEFAULT NULL COMMENT '职务',
  `phone` varchar(255) DEFAULT NULL COMMENT '办公电话',
  `mobile` varchar(255) DEFAULT NULL COMMENT '手机号码',
  `mobile2` varchar(255) DEFAULT NULL COMMENT '备用手机号码',
  `weixin_number` varchar(255) DEFAULT NULL COMMENT '微信号',
  `stars` char(1) DEFAULT '1' COMMENT '星级（1-2星，2-3星，3-3.5星，4-4星，5-4.5星，6-5星）',
  `description` varchar(255) DEFAULT NULL COMMENT '简介',
  `archives_id` bigint DEFAULT NULL COMMENT '档案ID',
  `employee_id` bigint NOT NULL COMMENT '业务员ID',
  `operator_id` bigint NOT NULL DEFAULT '0',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  `change_time` datetime DEFAULT NULL COMMENT '变更时间',
  `change_note` varchar(255) DEFAULT NULL COMMENT '变更说明',
  PRIMARY KEY (`contactman_info_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='联系人信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_contract`
--

DROP TABLE IF EXISTS `wb_contract`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_contract` (
  `contract_id` bigint NOT NULL AUTO_INCREMENT COMMENT '合同ID',
  `parent_id` bigint DEFAULT NULL COMMENT '关联合同',
  `contract_code` varchar(20) NOT NULL COMMENT '合同编码',
  `contract_name` varchar(255) NOT NULL COMMENT '名称',
  `project_id` bigint NOT NULL COMMENT '项目',
  `impl_project_id` bigint DEFAULT NULL COMMENT '实施项目ID',
  `company_id` bigint NOT NULL COMMENT '公司',
  `ba_id` bigint DEFAULT NULL,
  `customer_id` bigint NOT NULL COMMENT '客户',
  `contactman_id` bigint DEFAULT NULL COMMENT '客户联系人ID',
  `employee_id` bigint NOT NULL COMMENT '销售经理',
  `system_id` bigint DEFAULT NULL COMMENT '系统ID',
  `contract_type` char(1) DEFAULT '1' COMMENT '类型（0采购 1产品销售 2软件开发 3技术与数据服务 4设备与系统集成 5系统维护 6其他)',
  `is_third_party` char(1) NOT NULL DEFAULT 'N' COMMENT '是否三方',
  `third_party_id` bigint DEFAULT NULL COMMENT '第三方',
  `total_amount` decimal(10,2) DEFAULT NULL COMMENT '合同总金额',
  `prime_amount` decimal(10,2) DEFAULT NULL COMMENT '有效金额',
  `invoice_amount` decimal(10,2) DEFAULT '0.00' COMMENT '已开发票金额',
  `exec_amount` decimal(10,2) DEFAULT '0.00' COMMENT '已执行金额',
  `description` varchar(255) DEFAULT NULL COMMENT '主要内容',
  `payment` varchar(255) DEFAULT NULL COMMENT '付款方式',
  `tos` varchar(255) DEFAULT NULL COMMENT '服务条款',
  `service_period` int DEFAULT NULL COMMENT '服务周期(月)',
  `contract_period` int DEFAULT NULL COMMENT '合同周期(月)',
  `contract_status` char(1) DEFAULT NULL COMMENT '状态（0正常 1完结 2中止）',
  `sign_date` datetime DEFAULT NULL COMMENT '签订日期',
  `due_date` date DEFAULT NULL COMMENT '到期日',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  `old_id` bigint DEFAULT NULL COMMENT '老合同ID',
  PRIMARY KEY (`contract_id`),
  UNIQUE KEY `contract_code_UNIQUE` (`contract_code`)
) ENGINE=InnoDB AUTO_INCREMENT=2053 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='合同表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_employee`
--

DROP TABLE IF EXISTS `wb_employee`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_employee` (
  `employee_id` bigint NOT NULL AUTO_INCREMENT COMMENT '员工ID',
  `user_id` bigint DEFAULT NULL COMMENT '用户ID',
  `job_number` bigint DEFAULT NULL COMMENT '工号',
  `name` varchar(30) DEFAULT '' COMMENT '姓名',
  `id_number` varchar(18) NOT NULL DEFAULT '' COMMENT '身份证号',
  `date_of_birth` date DEFAULT NULL COMMENT '出生日期',
  `sex` char(1) DEFAULT '0' COMMENT '性别（0男 1女 2未知）',
  `education` char(1) DEFAULT '0' COMMENT '学历（0专科以下 1专科 2本科 3研究生 4博士）',
  `title` char(1) DEFAULT '0' COMMENT '职称（0无 1初级工程师 2中级工程师 3高级工程师 4高级以上）',
  `major` char(30) DEFAULT '' COMMENT '专业',
  `school` char(40) DEFAULT '' COMMENT '毕业院校',
  `graduation` datetime DEFAULT NULL COMMENT '毕业时间',
  `archive` char(1) DEFAULT '0' COMMENT '档案关系（0汇智 1汇房 2艾维 3普洛特 4滨州汇房）',
  `hiredate` date DEFAULT NULL COMMENT '入职日期',
  `emp_status` char(1) DEFAULT '1' COMMENT '状态（0试用 1在职 2离职）',
  `mobile_number` varchar(30) DEFAULT NULL COMMENT '手机号码',
  `phone_number` varchar(30) DEFAULT NULL COMMENT '电话号码',
  `email` varchar(30) DEFAULT '' COMMENT '电子邮箱地址',
  `home_address` varchar(255) DEFAULT '' COMMENT '家庭住址',
  `emergency_contact` varchar(30) DEFAULT NULL COMMENT '紧急联系人',
  `emergency_number` varchar(30) DEFAULT NULL COMMENT '紧急联系电话',
  `emergency_number2` varchar(30) DEFAULT NULL COMMENT '紧急联系电话2',
  `qq` char(30) DEFAULT '' COMMENT 'QQ号',
  `weixin` char(40) DEFAULT '' COMMENT '微信号',
  `ding_company` varchar(20) DEFAULT NULL COMMENT '钉钉公司',
  `att_group` varchar(40) DEFAULT NULL COMMENT '考勤组',
  `ding_id` varchar(20) DEFAULT NULL COMMENT '钉钉账号',
  `dept_id` bigint DEFAULT '100',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `operator_id` bigint NOT NULL DEFAULT '1',
  `operate_time` datetime DEFAULT NULL,
  PRIMARY KEY (`employee_id`),
  UNIQUE KEY `id_number_UNIQUE` (`id_number`)
) ENGINE=InnoDB AUTO_INCREMENT=435 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_employee_post`
--

DROP TABLE IF EXISTS `wb_employee_post`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_employee_post` (
  `employee_id` bigint NOT NULL COMMENT '员工ID',
  `post_id` bigint NOT NULL COMMENT '岗位ID',
  PRIMARY KEY (`employee_id`,`post_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工岗位表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_invoice`
--

DROP TABLE IF EXISTS `wb_invoice`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_invoice` (
  `invoice_id` bigint NOT NULL AUTO_INCREMENT COMMENT '发票ID',
  `invoice_code` varchar(10) DEFAULT NULL,
  `project_id` bigint DEFAULT NULL COMMENT '项目ID',
  `contract_id` bigint DEFAULT NULL COMMENT '合同ID',
  `company_id` bigint DEFAULT NULL,
  `receiver` varchar(255) DEFAULT NULL,
  `item` varchar(255) NOT NULL COMMENT '内容',
  `amount` decimal(12,2) DEFAULT NULL COMMENT '发票金额',
  `invoice_date` datetime DEFAULT NULL COMMENT '开票日期',
  `remark` varchar(255) DEFAULT NULL COMMENT '备注',
  `ap_id` varchar(36) DEFAULT NULL COMMENT '档案页ID',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  `oldcontract_id` bigint DEFAULT NULL COMMENT '老合同ID',
  `oldinvoice_id` bigint DEFAULT NULL,
  PRIMARY KEY (`invoice_id`)
) ENGINE=InnoDB AUTO_INCREMENT=12155 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='发票表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_markdown_file`
--

DROP TABLE IF EXISTS `wb_markdown_file`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_markdown_file` (
  `file_id` bigint NOT NULL AUTO_INCREMENT COMMENT '文件ID',
  `file_name` varchar(255) NOT NULL COMMENT '文件名称',
  `file_path` varchar(500) NOT NULL COMMENT 'OSS中的完整路径',
  `file_title` varchar(255) DEFAULT NULL COMMENT '文档标题',
  `file_summary` text COMMENT '文档摘要',
  `file_tags` varchar(500) DEFAULT NULL COMMENT '标签，逗号分隔',
  `file_size` bigint DEFAULT '0' COMMENT '文件大小（字节）',
  `oss_url` varchar(500) DEFAULT NULL COMMENT 'OSS访问URL',
  `folder_path` varchar(500) DEFAULT '/' COMMENT '文件夹路径',
  `content_preview` text COMMENT '内容预览（前200字符）',
  `word_count` int DEFAULT '0' COMMENT '字数统计',
  `is_public` char(1) DEFAULT '0' COMMENT '是否公开（0私有 1公开）',
  `view_count` int DEFAULT '0' COMMENT '查看次数',
  `employee_id` bigint DEFAULT NULL COMMENT '创建人员工ID',
  `update_by` bigint DEFAULT NULL COMMENT '更新人员工ID',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `del_flag` char(1) DEFAULT '0' COMMENT '删除标志（0代表存在 \n  2代表删除）',
  PRIMARY KEY (`file_id`),
  KEY `idx_employee_id` (`employee_id`),
  KEY `idx_folder_path` (`folder_path`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_del_flag` (`del_flag`),
  KEY `idx_is_public` (`is_public`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Markdown文件表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_markdown_folder`
--

DROP TABLE IF EXISTS `wb_markdown_folder`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_markdown_folder` (
  `folder_id` bigint NOT NULL AUTO_INCREMENT COMMENT '文件夹ID',
  `folder_name` varchar(255) NOT NULL COMMENT '文件夹名称',
  `parent_id` bigint DEFAULT '0' COMMENT '父文件夹ID，0为根目录',
  `folder_path` varchar(500) NOT NULL COMMENT '文件夹完整路径',
  `folder_level` int DEFAULT '1' COMMENT '文件夹层级',
  `sort_order` int DEFAULT '0' COMMENT '排序序号',
  `employee_id` bigint DEFAULT NULL COMMENT '创建人员工ID',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `del_flag` char(1) DEFAULT '0' COMMENT '删除标志（0代表存在 \n  2代表删除）',
  PRIMARY KEY (`folder_id`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_folder_path` (`folder_path`),
  KEY `idx_del_flag` (`del_flag`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Markdown文件夹表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_markdown_history`
--

DROP TABLE IF EXISTS `wb_markdown_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_markdown_history` (
  `history_id` bigint NOT NULL AUTO_INCREMENT COMMENT '历史记录ID',
  `file_id` bigint NOT NULL COMMENT '关联的markdown文件ID',
  `version_no` int NOT NULL COMMENT '版本号',
  `content_hash` varchar(64) DEFAULT NULL COMMENT '内容MD5哈希值',
  `file_size` bigint DEFAULT '0' COMMENT '文件大小（字节）',
  `oss_path` varchar(500) DEFAULT NULL COMMENT '历史版本OSS路径',
  `change_summary` varchar(500) DEFAULT NULL COMMENT '变更说明',
  `employee_id` bigint DEFAULT NULL COMMENT '操作人员工ID',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `del_flag` char(1) DEFAULT '0' COMMENT '删除标志（0代表存在 \n  2代表删除）',
  PRIMARY KEY (`history_id`),
  KEY `idx_file_id_version` (`file_id`,`version_no`),
  KEY `idx_employee_id` (`employee_id`),
  KEY `idx_del_flag` (`del_flag`),
  CONSTRAINT `wb_markdown_history_ibfk_1` FOREIGN KEY (`file_id`) REFERENCES `wb_markdown_file` (`file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Markdown文件历史版本表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_markdown_image`
--

DROP TABLE IF EXISTS `wb_markdown_image`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_markdown_image` (
  `image_id` bigint NOT NULL AUTO_INCREMENT COMMENT '图片ID',
  `file_id` bigint NOT NULL COMMENT '关联的markdown文件ID',
  `image_name` varchar(255) NOT NULL COMMENT '图片文件名',
  `image_path` varchar(500) NOT NULL COMMENT 'OSS中的图片路径',
  `image_url` varchar(500) NOT NULL COMMENT '图片访问URL',
  `file_size` bigint DEFAULT '0' COMMENT '图片大小（字节）',
  `image_width` int DEFAULT NULL COMMENT '图片宽度',
  `image_height` int DEFAULT NULL COMMENT '图片高度',
  `image_type` varchar(20) DEFAULT NULL COMMENT '图片类型（jpg,png,gif等）',
  `thumbnail_url` varchar(500) DEFAULT NULL COMMENT '缩略图URL',
  `employee_id` bigint DEFAULT NULL COMMENT '上传人员工ID',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `del_flag` char(1) DEFAULT '0' COMMENT '删除标志（0代表存在 \n  2代表删除）',
  PRIMARY KEY (`image_id`),
  KEY `idx_file_id` (`file_id`),
  KEY `idx_employee_id` (`employee_id`),
  KEY `idx_del_flag` (`del_flag`),
  CONSTRAINT `wb_markdown_image_ibfk_1` FOREIGN KEY (`file_id`) REFERENCES `wb_markdown_file` (`file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Markdown文件关联图片表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_month`
--

DROP TABLE IF EXISTS `wb_month`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_month` (
  `month_id` bigint NOT NULL AUTO_INCREMENT COMMENT '月度ID',
  `year_and_month` char(7) NOT NULL COMMENT '月度',
  `start_date` date DEFAULT NULL COMMENT '起始日',
  `end_date` date DEFAULT NULL COMMENT '终止日',
  `work_days` int DEFAULT NULL COMMENT '工作日',
  `description` varchar(255) DEFAULT NULL COMMENT '说明',
  PRIMARY KEY (`month_id`),
  UNIQUE KEY `year_and_month` (`year_and_month`)
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='月度表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_month_state`
--

DROP TABLE IF EXISTS `wb_month_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_month_state` (
  `ms_id` bigint NOT NULL AUTO_INCREMENT COMMENT '月度状态ID',
  `biz_month` varchar(7) NOT NULL COMMENT '业务月份',
  `att_num_last` int DEFAULT '0' COMMENT '上月考勤人数',
  `att_num` int DEFAULT '0' COMMENT '考勤人数',
  `att_confirmed` int DEFAULT '0' COMMENT '考勤确认人数',
  `rpt_num_last` int DEFAULT '0' COMMENT '上月月报人数',
  `rpt_num` int DEFAULT '0' COMMENT '月报人数',
  `rpt_confirmed` int DEFAULT '0' COMMENT '月报确认人数',
  `pa_num_last` int DEFAULT '0' COMMENT '上月考核人数',
  `pa_num` int DEFAULT '0' COMMENT '考核人数',
  `pa_confirmed` int DEFAULT '0' COMMENT '考核完成人数',
  `pa_person_time` int DEFAULT '0' COMMENT '考核总人次',
  `pa_rated_time` int DEFAULT '0' COMMENT '考核完成人次',
  `wa_num_last` int DEFAULT '0' COMMENT '上月发薪人数',
  `wa_num` int DEFAULT '0' COMMENT '发薪人数',
  `wa_confirmed` int DEFAULT '0' COMMENT '工资确认人数',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  PRIMARY KEY (`ms_id`),
  UNIQUE KEY `biz_month` (`biz_month`)
) ENGINE=InnoDB AUTO_INCREMENT=44 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='月度状态表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_organization`
--

DROP TABLE IF EXISTS `wb_organization`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_organization` (
  `org_id` bigint NOT NULL AUTO_INCREMENT COMMENT '组织ID',
  `parent_id` bigint DEFAULT NULL COMMENT '父组织ID',
  `ancestors` varchar(50) DEFAULT NULL COMMENT '祖级列表',
  `order_num` int DEFAULT '0' COMMENT '显示顺序',
  `org_name` varchar(255) NOT NULL COMMENT '名称',
  `short_name` varchar(30) DEFAULT NULL COMMENT '简称',
  `org_type` char(1) DEFAULT '1' COMMENT '类型（1客户 2经销商 3供应商)',
  `employee_id` bigint NOT NULL DEFAULT '1',
  `contactman_id` bigint DEFAULT NULL COMMENT '联系人ID',
  `contactman` varchar(30) DEFAULT NULL COMMENT '联系人',
  `telephone` varchar(20) DEFAULT NULL COMMENT '联系电话',
  `level` int DEFAULT '6' COMMENT '等级',
  `province` varchar(20) NOT NULL DEFAULT '山东省' COMMENT '省/直辖市',
  `city` varchar(20) NOT NULL DEFAULT '济南市' COMMENT '地市',
  `web_site` varchar(255) DEFAULT NULL COMMENT '网址',
  `weixin_number` varchar(255) DEFAULT NULL COMMENT '微信公众号',
  `description` varchar(255) DEFAULT NULL COMMENT '单位简介',
  `org_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1删除)',
  `start_date` date DEFAULT NULL COMMENT '起始日期',
  `count_all` int DEFAULT '0' COMMENT '总合同数（含下属单位）',
  `sum_all` decimal(12,2) DEFAULT '0.00' COMMENT '全部合同额（含下属单位）',
  `count_total` int DEFAULT '0' COMMENT '总合同数',
  `sum_total` decimal(12,2) DEFAULT '0.00' COMMENT '总合同额',
  `count_three` int DEFAULT '0' COMMENT '近三年合同数',
  `sum_three` decimal(12,2) DEFAULT '0.00' COMMENT '近三年合同额',
  `count_year` int DEFAULT '0' COMMENT '一年内合同数',
  `sum_year` decimal(12,2) DEFAULT '0.00' COMMENT '近一年合同额',
  `count_current_year` int DEFAULT '0' COMMENT '当年合同额',
  `sum_current_year` decimal(12,2) DEFAULT '0.00' COMMENT '当年合同额',
  `count_recerivable` int DEFAULT '0' COMMENT '应收款合同数',
  `sum_all_receivable` decimal(12,2) DEFAULT '0.00' COMMENT '总应收款',
  `sum_receivable` decimal(12,2) DEFAULT '0.00' COMMENT '应收款',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `operator_id` bigint NOT NULL COMMENT '用户ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`org_id`),
  UNIQUE KEY `org_name_UNIQUE` (`org_name`)
) ENGINE=InnoDB AUTO_INCREMENT=962 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='组织表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_organization_info`
--

DROP TABLE IF EXISTS `wb_organization_info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_organization_info` (
  `org_info_id` bigint NOT NULL AUTO_INCREMENT COMMENT '组织信息ID',
  `org_id` bigint NOT NULL COMMENT '组织ID',
  `up_org_id` bigint DEFAULT NULL COMMENT '上级组织ID',
  `name` varchar(255) NOT NULL COMMENT '名称',
  `short_name` varchar(30) DEFAULT NULL COMMENT '简称',
  `type` char(1) DEFAULT '1' COMMENT '类型（1客户 2经销商 3供应商)',
  `web_site` varchar(255) DEFAULT NULL COMMENT '网址',
  `weixin_number` varchar(255) DEFAULT NULL COMMENT '微信公众号',
  `description` varchar(255) DEFAULT NULL COMMENT '单位简介',
  `archives_id` bigint DEFAULT NULL COMMENT '档案ID',
  `employee_id` bigint NOT NULL COMMENT '业务员ID',
  `operator_id` bigint NOT NULL,
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  `change_time` datetime DEFAULT NULL COMMENT '变更时间',
  `change_note` varchar(255) DEFAULT NULL COMMENT '变更说明',
  PRIMARY KEY (`org_info_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='组织信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_pa_define`
--

DROP TABLE IF EXISTS `wb_pa_define`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_pa_define` (
  `pd_id` bigint NOT NULL AUTO_INCREMENT COMMENT '考核定义ID',
  `employee_id` bigint NOT NULL COMMENT '员工ID',
  `pa_type` char(1) NOT NULL DEFAULT '1' COMMENT '考核类型(0不参与 1默认 2自定义)',
  `rater1_id` bigint DEFAULT NULL COMMENT '初评人员ID',
  `rater2_id` bigint DEFAULT NULL COMMENT '复评人员ID',
  `rater3_id` bigint DEFAULT NULL COMMENT '终评人员ID',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `operator_id` bigint NOT NULL COMMENT '操作人员',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`pd_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='考核定义表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_pa_record`
--

DROP TABLE IF EXISTS `wb_pa_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_pa_record` (
  `pr_id` bigint NOT NULL AUTO_INCREMENT COMMENT '考核记录ID',
  `employee_id` bigint NOT NULL COMMENT '员工ID',
  `pa_month` varchar(7) NOT NULL COMMENT '考核月份',
  `pa_phase` varchar(1) NOT NULL COMMENT '考核阶段(1初评 2复评 3终评)',
  `dept_id` bigint DEFAULT NULL COMMENT '部门ID',
  `dept_name` varchar(20) DEFAULT NULL COMMENT '部门名称',
  `employee_name` varchar(50) NOT NULL COMMENT '姓名',
  `rank_code` varchar(10) DEFAULT NULL COMMENT '职级',
  `attendance` varchar(500) DEFAULT NULL COMMENT '考勤情况',
  `difficulty` int DEFAULT '0' COMMENT '工作难度',
  `workload` int DEFAULT '0' COMMENT '工作量',
  `quality` int DEFAULT '0' COMMENT '工作质量',
  `mng_number` int DEFAULT '0' COMMENT '管理人数',
  `mng_level` int DEFAULT '0' COMMENT '管理水平',
  `exec_force` int DEFAULT '0' COMMENT '执行力',
  `pa_score` decimal(5,2) DEFAULT NULL COMMENT '考核分数',
  `pa_level` char(1) DEFAULT NULL COMMENT '考核等级(ABCD)',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0未提交 1已提交）',
  `rater_id` bigint NOT NULL COMMENT '考核人员',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`pr_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1002 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='考核记录表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_payment_plan`
--

DROP TABLE IF EXISTS `wb_payment_plan`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_payment_plan` (
  `pp_id` bigint NOT NULL AUTO_INCREMENT COMMENT '付款计划ID',
  `org_id` bigint NOT NULL COMMENT '公司ID',
  `planned_date` date NOT NULL COMMENT '计划付款日期',
  `amount` decimal(12,0) NOT NULL COMMENT '付款金额',
  `matter` varchar(255) NOT NULL COMMENT '事由',
  `pay_status` char(1) NOT NULL DEFAULT '0' COMMENT '付款状态(0未付 1已付)',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`pp_id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='付款计划表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_post`
--

DROP TABLE IF EXISTS `wb_post`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_post` (
  `post_id` bigint NOT NULL AUTO_INCREMENT COMMENT '岗位ID',
  `post_code` varchar(64) NOT NULL COMMENT '岗位编码',
  `post_name` varchar(50) NOT NULL COMMENT '岗位名称',
  `post_sort` int NOT NULL COMMENT '显示顺序',
  `status` char(1) NOT NULL COMMENT '状态（0正常 1停用）',
  `create_by` varchar(64) DEFAULT '' COMMENT '创建者',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(64) DEFAULT '' COMMENT '更新者',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`post_id`),
  UNIQUE KEY `post_code_UNIQUE` (`post_code`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='岗位信息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_product`
--

DROP TABLE IF EXISTS `wb_product`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_product` (
  `product_id` bigint NOT NULL AUTO_INCREMENT COMMENT '产品ID',
  `parent_id` bigint DEFAULT NULL COMMENT '父产品ID',
  `product_code` varchar(20) NOT NULL COMMENT '产品编码',
  `product_name` varchar(40) NOT NULL COMMENT '名称',
  `solution_id` bigint NOT NULL COMMENT '解决方案',
  `dept_id` bigint NOT NULL COMMENT '归口部门',
  `employee_id` bigint NOT NULL COMMENT '产品经理',
  `start_date` date DEFAULT NULL COMMENT '启动日期',
  `product_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `completeness` int DEFAULT NULL COMMENT '完成度',
  `description` varchar(255) DEFAULT NULL COMMENT '产品描述',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `operator_id` bigint NOT NULL COMMENT '用户ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='产品表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_product_version`
--

DROP TABLE IF EXISTS `wb_product_version`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_product_version` (
  `pv_id` bigint NOT NULL AUTO_INCREMENT COMMENT '产品版本ID',
  `pv_code` varchar(20) NOT NULL COMMENT '版本代码',
  `product_id` bigint NOT NULL COMMENT '产品ID',
  `start_date` date DEFAULT NULL COMMENT '启动日期',
  `pv_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `completeness` int DEFAULT NULL COMMENT '完成度',
  `repository` varchar(255) DEFAULT NULL COMMENT '仓库地址',
  `description` varchar(255) DEFAULT NULL COMMENT '版本描述',
  `operator_id` bigint NOT NULL COMMENT '用户ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`pv_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='产品版本表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_project`
--

DROP TABLE IF EXISTS `wb_project`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_project` (
  `project_id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目ID',
  `parent_id` bigint DEFAULT '0' COMMENT '上级项目ID',
  `org_id` bigint DEFAULT NULL COMMENT '组织ID',
  `dept_id` bigint NOT NULL COMMENT '部门ID',
  `employee_id` bigint NOT NULL DEFAULT '1' COMMENT '项目经理',
  `assistant_id` bigint DEFAULT NULL COMMENT '助理ID',
  `assistant_ratio` int DEFAULT '0' COMMENT '助理占比',
  `prj_name` varchar(255) NOT NULL COMMENT '名称',
  `short_name` varchar(20) DEFAULT NULL COMMENT '简称',
  `prj_type` char(2) NOT NULL DEFAULT '22' COMMENT '类型（0企业管理 1人力资源 2财务 3行政 4企业策划 5市场营销 6销售 7研发 8运维 9运营)',
  `prj_code` varchar(255) NOT NULL COMMENT '编码',
  `prov_rates` int DEFAULT '0' COMMENT '计提比例',
  `solution_id` bigint DEFAULT NULL COMMENT '解决方案ID',
  `product_id` bigint DEFAULT NULL,
  `pm_number` int DEFAULT NULL,
  `budget` decimal(12,2) DEFAULT '0.00' COMMENT '预算',
  `contracts` int DEFAULT '0' COMMENT '合同数',
  `amount` decimal(12,2) DEFAULT '0.00' COMMENT '金额',
  `incomes` int DEFAULT '0' COMMENT '收入笔数',
  `income_amount` decimal(12,2) DEFAULT '0.00' COMMENT '收入金额',
  `payments` int DEFAULT '0' COMMENT '支出笔数',
  `payment_amount` decimal(12,2) DEFAULT '0.00' COMMENT '支出金额',
  `man_hours` decimal(8,2) DEFAULT '0.00' COMMENT '工时数',
  `hr_cost` decimal(12,2) DEFAULT '0.00' COMMENT '人力成本',
  `year_contracts` int DEFAULT '0' COMMENT '当年合同数',
  `year_amount` decimal(12,2) DEFAULT '0.00' COMMENT '当年合同额',
  `year_contract_incomes` int DEFAULT NULL COMMENT '当年合同收入笔数',
  `year_contract_income` decimal(12,2) DEFAULT NULL COMMENT '当年合同收入额',
  `year_other_incomes` int DEFAULT NULL COMMENT '当年非合同收入笔数',
  `year_other_income` decimal(12,2) DEFAULT NULL COMMENT '当年非合同收入额',
  `year_incomes` int DEFAULT '0' COMMENT '当年收入笔数',
  `year_income` decimal(12,2) DEFAULT '0.00' COMMENT '当年收入额',
  `year_payments` int DEFAULT '0' COMMENT '当年支出笔数',
  `year_payment` decimal(12,2) DEFAULT '0.00' COMMENT '当年支出',
  `year_hours` decimal(8,2) DEFAULT '0.00' COMMENT '当年工时',
  `year_cost` decimal(12,2) DEFAULT '0.00' COMMENT '当年人力成本',
  `year_ratio` int DEFAULT '0' COMMENT '当年业绩占比',
  `year_strength` decimal(8,2) DEFAULT NULL,
  `activation` decimal(14,2) DEFAULT '0.00' COMMENT '活跃度',
  `sub_projects` int DEFAULT '0',
  `stat_date` date DEFAULT NULL COMMENT '统计日期',
  `prj_status` char(1) DEFAULT NULL COMMENT '状态（0正常 1完结 2中止）',
  `pmw_balance` decimal(5,2) DEFAULT NULL,
  `amount_balance` decimal(12,2) DEFAULT '0.00',
  `income_balance` decimal(12,2) DEFAULT '0.00',
  `payment_balance` decimal(12,2) DEFAULT '0.00',
  `start_date` date DEFAULT NULL COMMENT '启动日期',
  `end_date` date DEFAULT NULL COMMENT '结束日期',
  `description` varchar(255) DEFAULT NULL COMMENT '简介',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `operator_id` bigint DEFAULT NULL COMMENT '用户ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`project_id`),
  UNIQUE KEY `prj_code_UNIQUE` (`prj_code`)
) ENGINE=InnoDB AUTO_INCREMENT=377 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='项目表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_project_contribution`
--

DROP TABLE IF EXISTS `wb_project_contribution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_project_contribution` (
  `pc_id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目成员贡献ID',
  `pr_id` bigint NOT NULL COMMENT '项目月报ID',
  `project_id` bigint DEFAULT NULL COMMENT '项目ID',
  `work_month` varchar(7) DEFAULT NULL COMMENT '月份',
  `month_hours` decimal(8,2) DEFAULT NULL COMMENT '月度工时',
  `employee_id` bigint NOT NULL COMMENT '员工ID',
  `work_hour` decimal(8,2) DEFAULT NULL COMMENT '工时',
  `contrib_ratio` bigint DEFAULT NULL COMMENT '贡献占比',
  `work_ratio` bigint DEFAULT NULL COMMENT '工时占比',
  `description` varchar(255) DEFAULT NULL COMMENT '说明',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`pc_id`)
) ENGINE=InnoDB AUTO_INCREMENT=57395 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='项目成员贡献表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_project_income`
--

DROP TABLE IF EXISTS `wb_project_income`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_project_income` (
  `pi_id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目收入ID',
  `pi_code` varchar(10) DEFAULT NULL,
  `project_id` bigint NOT NULL COMMENT '项目ID',
  `employee_id` bigint NOT NULL COMMENT '经办人',
  `receipt_date` date NOT NULL COMMENT '到账日期',
  `amount` decimal(10,2) DEFAULT NULL COMMENT '金额',
  `channel` varchar(1) DEFAULT NULL COMMENT '收款渠道(0现金 1银行转账 2第三方支付)',
  `ba_id` bigint DEFAULT NULL COMMENT '收款账户',
  `income_type` varchar(2) DEFAULT NULL COMMENT '收入类型(00一次性收入 01定金/预付款 02首付款 03阶段付款 04验收付款 05尾款 06维护费 07退款 08退税 09其他业务收入 10利息收入 11补贴 12资产处置 13投资款 14借款 19其他非业务收入)',
  `payer` varchar(255) DEFAULT NULL,
  `matter` varchar(255) DEFAULT NULL COMMENT '事由',
  `contract_id` bigint DEFAULT NULL COMMENT '合同Id',
  `pp_id` bigint DEFAULT NULL COMMENT '对应支出Id',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  `oldpayment_id` bigint DEFAULT NULL,
  PRIMARY KEY (`pi_id`)
) ENGINE=InnoDB AUTO_INCREMENT=15055 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='项目收入表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_project_member`
--

DROP TABLE IF EXISTS `wb_project_member`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_project_member` (
  `pm_id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目成员ID',
  `project_id` bigint NOT NULL COMMENT '项目ID',
  `employee_id` bigint DEFAULT NULL COMMENT '员工ID',
  `pm_name` varchar(20) DEFAULT NULL COMMENT '姓名',
  `pm_type` char(1) DEFAULT '1' COMMENT '类型（0项目负责人 1成员 2外部成员)',
  `cb_ratio` decimal(5,2) DEFAULT NULL COMMENT '占比',
  `pm_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1退出）',
  `description` varchar(255) DEFAULT NULL COMMENT '说明',
  `join_time` datetime DEFAULT NULL COMMENT '加入时间',
  `quit_time` datetime DEFAULT NULL COMMENT '退出时间',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`pm_id`)
) ENGINE=InnoDB AUTO_INCREMENT=72235 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='项目成员表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_project_payment`
--

DROP TABLE IF EXISTS `wb_project_payment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_project_payment` (
  `pp_id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目支出ID',
  `pp_code` varchar(10) DEFAULT NULL,
  `project_id` bigint NOT NULL COMMENT '项目ID',
  `employee_id` bigint NOT NULL COMMENT '经办人',
  `pay_date` date NOT NULL COMMENT '支付日期',
  `amount` decimal(10,2) DEFAULT NULL COMMENT '金额',
  `charge` decimal(10,2) DEFAULT NULL COMMENT '手续费',
  `process_code` varchar(30) DEFAULT NULL COMMENT '审批编号',
  `channel` varchar(1) DEFAULT NULL COMMENT '支付渠道(0现金 1银行转账 2第三方支付)',
  `ba_id` bigint DEFAULT NULL COMMENT '付款账户',
  `payment_type` varchar(2) DEFAULT NULL COMMENT '支出类型(00差旅费 01业务招待费 02销售费用 03项目采购 04人员薪资 05奖励/提成 06税费 07退款 09其他业务支出 10办公费 11固定资产采购 12管理人员薪资 13管理人员奖励 14房租 15车辆费用 19其他管理费 20银行手续费 21利息支出 29其他财务费用)',
  `matter` varchar(255) DEFAULT NULL COMMENT '事由',
  `contract_id` bigint DEFAULT NULL COMMENT '合同Id',
  `pi_id` bigint DEFAULT NULL COMMENT '对应收入Id',
  `receiver` varchar(50) DEFAULT NULL COMMENT '收款人',
  `receiver_acc` varchar(30) DEFAULT NULL COMMENT '收款账号',
  `receiver_bank` varchar(100) DEFAULT NULL COMMENT '收款银行',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`pp_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4378 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='项目支出表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_project_portion`
--

DROP TABLE IF EXISTS `wb_project_portion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_project_portion` (
  `portion_id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目分配ID',
  `portion_type` char(1) NOT NULL COMMENT '分配类型（1合同，2收入，3费用，4项目成员贡献）',
  `project_id` bigint NOT NULL COMMENT '项目ID',
  `project_code` varchar(20) NOT NULL COMMENT '项目编码',
  `project_name` varchar(255) NOT NULL COMMENT '项目名称',
  `contract_id` bigint DEFAULT NULL COMMENT '合同ID',
  `contract_name` varchar(255) DEFAULT NULL COMMENT '合同名称',
  `sub_id` bigint DEFAULT NULL COMMENT '子项目ID',
  `sub_name` varchar(255) DEFAULT NULL COMMENT '子项目名称',
  `employee_id` bigint DEFAULT NULL COMMENT '项目成员',
  `employee_name` varchar(50) DEFAULT NULL COMMENT '姓名',
  `fiscal_year` varchar(4) NOT NULL COMMENT '财年',
  `rora` char(1) NOT NULL DEFAULT '0' COMMENT '占比或金额（0占比，1金额）',
  `ratio` decimal(5,2) NOT NULL DEFAULT '0.00' COMMENT '占比',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '金额',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`portion_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='项目分配表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_project_report`
--

DROP TABLE IF EXISTS `wb_project_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_project_report` (
  `pr_id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目月报ID',
  `project_id` bigint NOT NULL COMMENT '项目ID',
  `parent_id` bigint DEFAULT NULL,
  `project_code` varchar(50) DEFAULT NULL,
  `project_name` varchar(200) DEFAULT NULL,
  `project_type` varchar(2) DEFAULT NULL,
  `dept_id` bigint DEFAULT NULL,
  `dept_name` varchar(45) DEFAULT NULL,
  `dept_type` char(1) DEFAULT NULL COMMENT '部门类型',
  `employee_id` bigint DEFAULT NULL,
  `employee_name` varchar(45) DEFAULT NULL,
  `customer_id` bigint DEFAULT NULL,
  `customer_name` varchar(100) DEFAULT NULL,
  `report_type` varchar(1) DEFAULT NULL,
  `work_month` char(7) NOT NULL COMMENT '月份',
  `month_hours` bigint DEFAULT '0',
  `stage` char(1) DEFAULT '0' COMMENT '阶段（0进行中 1需求 2设计 3编码 4部署 5试运行 6投产)',
  `ratio` bigint DEFAULT '0' COMMENT '当月进度%',
  `total_ratio` bigint DEFAULT '0' COMMENT '总进度%',
  `content` varchar(500) DEFAULT NULL COMMENT '报告内容',
  `sub_projects` int DEFAULT '0',
  `contracts` int DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT '0.00' COMMENT '总工时',
  `prov_amount` decimal(10,2) DEFAULT '0.00' COMMENT '扣减合同额',
  `shared_amount` decimal(10,2) DEFAULT '0.00' COMMENT '分摊合同额',
  `contract_incomes` int DEFAULT NULL,
  `contract_income` decimal(10,2) DEFAULT NULL,
  `other_incomes` int DEFAULT NULL,
  `other_income` decimal(10,2) DEFAULT NULL,
  `incomes` int DEFAULT NULL,
  `income_amount` decimal(10,2) DEFAULT NULL,
  `purchase_cost` decimal(10,2) DEFAULT '0.00',
  `prov_income` decimal(10,2) DEFAULT '0.00' COMMENT '计提金额',
  `shared_income` decimal(10,2) DEFAULT '0.00' COMMENT '分享收入',
  `net_income` decimal(10,2) DEFAULT '0.00' COMMENT '净收入',
  `strength` decimal(8,2) DEFAULT '0.00' COMMENT '参与人数',
  `man_hours` decimal(8,2) DEFAULT '0.00' COMMENT '当月工时',
  `cost` decimal(10,2) DEFAULT '0.00' COMMENT '当月成本',
  `mng_cost` decimal(10,2) DEFAULT '0.00' COMMENT '管理成本',
  `sub_cost` decimal(10,2) DEFAULT '0.00',
  `total_cost` decimal(10,2) DEFAULT '0.00',
  `payments` int DEFAULT '0' COMMENT '总成本',
  `fee` decimal(10,2) DEFAULT '0.00',
  `sub_fee` decimal(10,2) DEFAULT '0.00',
  `sales_fee` decimal(10,2) DEFAULT '0.00',
  `commission` decimal(10,2) DEFAULT '0.00' COMMENT '销售提成',
  `shared_fee` decimal(10,2) DEFAULT '0.00' COMMENT '分摊费用',
  `total_fee` decimal(10,2) DEFAULT '0.00',
  `spending` decimal(10,2) DEFAULT '0.00' COMMENT '当月支出',
  `sub_spending` decimal(10,2) DEFAULT '0.00',
  `net_amount` decimal(10,2) DEFAULT '0.00' COMMENT '净合同额',
  `total_spending` decimal(10,2) DEFAULT '0.00',
  `profit` decimal(10,2) DEFAULT '0.00',
  `pr_status` varchar(1) DEFAULT '0' COMMENT '状态（0未填报 1已填报 2已提交）',
  `reporter_id` bigint DEFAULT NULL COMMENT '填报人',
  `report_time` datetime DEFAULT NULL COMMENT '填报时间',
  `auditor_id` bigint DEFAULT NULL COMMENT '审核人',
  `audit_time` datetime DEFAULT NULL COMMENT '审核时间',
  PRIMARY KEY (`pr_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9911 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='项目月报表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_rank`
--

DROP TABLE IF EXISTS `wb_rank`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_rank` (
  `rank_id` bigint NOT NULL AUTO_INCREMENT COMMENT '职级ID',
  `rank_code` varchar(64) NOT NULL COMMENT '职级编码',
  `rank_name` varchar(50) NOT NULL COMMENT '职级名称',
  `min_salary` decimal(8,2) DEFAULT NULL COMMENT '参考最低薪资',
  `max_salary` decimal(8,2) DEFAULT NULL COMMENT '参考最高薪资',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`rank_id`),
  UNIQUE KEY `rank_code_UNIQUE` (`rank_code`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='职级表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_repository`
--

DROP TABLE IF EXISTS `wb_repository`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_repository` (
  `repos_id` bigint NOT NULL AUTO_INCREMENT COMMENT '仓库ID',
  `project_id` bigint DEFAULT NULL COMMENT '项目ID',
  `repos_name` varchar(20) NOT NULL COMMENT '名称',
  `repos_url` varchar(200) DEFAULT NULL COMMENT 'URL',
  `revision` int DEFAULT NULL COMMENT '当前版本',
  `start_time` datetime DEFAULT NULL COMMENT '创建时间',
  `last_time` datetime DEFAULT NULL COMMENT '最后提交时间',
  `repos_type` char(1) DEFAULT '1' COMMENT '类型（1SVN 2git)',
  `repos_code` varchar(40) DEFAULT NULL COMMENT '编码',
  `repos_status` char(1) DEFAULT NULL COMMENT '状态（0正常 1关闭）',
  `description` varchar(255) DEFAULT NULL COMMENT '简介',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`repos_id`),
  UNIQUE KEY `repos_name_UNIQUE` (`repos_name`)
) ENGINE=InnoDB AUTO_INCREMENT=233 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='版本仓库表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_salary`
--

DROP TABLE IF EXISTS `wb_salary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_salary` (
  `salary_id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `salary_month` varchar(7) NOT NULL COMMENT '发薪月份',
  `sn` bigint DEFAULT NULL COMMENT '序号',
  `employee_id` bigint DEFAULT NULL COMMENT '员工ID',
  `employee_name` varchar(50) NOT NULL COMMENT '姓名',
  `work_days` decimal(4,2) DEFAULT NULL COMMENT '全勤天数',
  `att_days` decimal(4,2) DEFAULT NULL COMMENT '出勤天数',
  `sick_days` decimal(4,2) DEFAULT NULL COMMENT '病假天数',
  `leave_days` decimal(4,2) DEFAULT NULL COMMENT '事假天数',
  `other_days` decimal(4,2) DEFAULT NULL COMMENT '其他天数',
  `base_salary` decimal(8,2) DEFAULT NULL COMMENT '基本工资',
  `rank_salary` decimal(8,2) DEFAULT NULL COMMENT '职级工资',
  `pa_level` varchar(1) DEFAULT NULL COMMENT '绩效等级',
  `float_rate` decimal(4,2) DEFAULT NULL COMMENT '浮动比例',
  `rank_float` decimal(8,2) DEFAULT NULL COMMENT '职级绩效工资',
  `secrecy_subsidy` decimal(8,2) DEFAULT NULL COMMENT '保密津贴',
  `lunch_subsidy` decimal(8,2) DEFAULT NULL COMMENT '午餐补助',
  `comm_subsidy` decimal(8,2) DEFAULT NULL COMMENT '通讯补助',
  `trans_subsidy` decimal(8,2) DEFAULT NULL COMMENT '交通补助',
  `total_salary` decimal(8,2) DEFAULT NULL COMMENT '工资总额',
  `daily_salary` decimal(8,2) DEFAULT NULL COMMENT '日工资',
  `deduction` decimal(8,2) DEFAULT NULL COMMENT '缺勤扣款',
  `other_paid` decimal(8,2) DEFAULT NULL COMMENT '发其他',
  `other_withhold` decimal(8,2) DEFAULT NULL COMMENT '扣其他',
  `payable` decimal(8,2) DEFAULT NULL COMMENT '应发工资',
  `ins_company` decimal(8,2) DEFAULT NULL COMMENT '公司缴纳',
  `ss_personal` decimal(8,2) DEFAULT NULL COMMENT '个人社保',
  `mi_personal` decimal(8,2) DEFAULT NULL COMMENT '个人医保',
  `ui_personal` decimal(8,2) DEFAULT NULL COMMENT '个人失业',
  `hpf_company` decimal(8,2) DEFAULT NULL COMMENT '公司公积金',
  `hpf_personal` decimal(8,2) DEFAULT NULL COMMENT '个人公积金',
  `taxation` decimal(8,2) DEFAULT NULL COMMENT '所得税代扣',
  `legal_withhold` decimal(8,2) DEFAULT NULL COMMENT '代扣缴',
  `actually_paid` decimal(8,2) DEFAULT NULL COMMENT '实发工资',
  `signature` varchar(100) DEFAULT NULL COMMENT '签名',
  `total_payout` decimal(8,2) DEFAULT '0.00' COMMENT '总支出',
  `flu_remark` varchar(200) DEFAULT NULL COMMENT '备注',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1已应用）',
  `operator_id` bigint NOT NULL COMMENT '操作人员',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`salary_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5983 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工资表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_salary_adjustment`
--

DROP TABLE IF EXISTS `wb_salary_adjustment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_salary_adjustment` (
  `sa_id` bigint NOT NULL AUTO_INCREMENT COMMENT '参数ID',
  `employee_id` bigint DEFAULT NULL COMMENT '员工ID',
  `base_salary` decimal(8,2) DEFAULT NULL COMMENT '基础工资',
  `ss_base` decimal(8,2) DEFAULT NULL COMMENT '社保基数',
  `mi_base` decimal(8,2) DEFAULT NULL COMMENT '医保基数',
  `hpf_base` decimal(8,2) DEFAULT NULL COMMENT '公积金基数',
  `trans_subsidy` decimal(8,2) DEFAULT NULL COMMENT '交通补贴',
  `comm_subsidy` decimal(8,2) DEFAULT NULL COMMENT '通讯补贴',
  `lunch_subsidy` decimal(8,2) DEFAULT NULL COMMENT '午餐补贴',
  `start_date` date DEFAULT NULL COMMENT '开始时间',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `operator_id` bigint NOT NULL COMMENT '操作人员',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`sa_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工资调整表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_salary_bk_0919`
--

DROP TABLE IF EXISTS `wb_salary_bk_0919`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_salary_bk_0919` (
  `salary_id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `salary_month` varchar(7) NOT NULL COMMENT '发薪月份',
  `sn` bigint DEFAULT NULL COMMENT '序号',
  `employee_id` bigint DEFAULT NULL COMMENT '员工ID',
  `employee_name` varchar(50) NOT NULL COMMENT '姓名',
  `work_days` decimal(4,2) DEFAULT NULL COMMENT '全勤天数',
  `att_days` decimal(4,2) DEFAULT NULL COMMENT '出勤天数',
  `sick_days` decimal(4,2) DEFAULT NULL COMMENT '病假天数',
  `leave_days` decimal(4,2) DEFAULT NULL COMMENT '事假天数',
  `other_days` decimal(4,2) DEFAULT NULL COMMENT '其他天数',
  `base_salary` decimal(8,2) DEFAULT NULL COMMENT '基本工资',
  `rank_salary` decimal(8,2) DEFAULT NULL COMMENT '职级工资',
  `pa_level` varchar(1) DEFAULT NULL COMMENT '绩效等级',
  `float_rate` decimal(4,2) DEFAULT NULL COMMENT '浮动比例',
  `rank_float` decimal(8,2) DEFAULT NULL COMMENT '职级绩效工资',
  `secrecy_subsidy` decimal(8,2) DEFAULT NULL COMMENT '保密津贴',
  `lunch_subsidy` decimal(8,2) DEFAULT NULL COMMENT '午餐补助',
  `comm_subsidy` decimal(8,2) DEFAULT NULL COMMENT '通讯补助',
  `trans_subsidy` decimal(8,2) DEFAULT NULL COMMENT '交通补助',
  `total_salary` decimal(8,2) DEFAULT NULL COMMENT '工资总额',
  `daily_salary` decimal(8,2) DEFAULT NULL COMMENT '日工资',
  `deduction` decimal(8,2) DEFAULT NULL COMMENT '缺勤扣款',
  `other_paid` decimal(8,2) DEFAULT NULL COMMENT '发其他',
  `other_withhold` decimal(8,2) DEFAULT NULL COMMENT '扣其他',
  `payable` decimal(8,2) DEFAULT NULL COMMENT '应发工资',
  `ins_company` decimal(8,2) DEFAULT NULL COMMENT '公司缴纳',
  `ss_personal` decimal(8,2) DEFAULT NULL COMMENT '个人社保',
  `mi_personal` decimal(8,2) DEFAULT NULL COMMENT '个人医保',
  `ui_personal` decimal(8,2) DEFAULT NULL COMMENT '个人失业',
  `hpf_company` decimal(8,2) DEFAULT NULL COMMENT '公司公积金',
  `hpf_personal` decimal(8,2) DEFAULT NULL COMMENT '个人公积金',
  `taxation` decimal(8,2) DEFAULT NULL COMMENT '所得税代扣',
  `legal_withhold` decimal(8,2) DEFAULT NULL COMMENT '代扣缴',
  `actually_paid` decimal(8,2) DEFAULT NULL COMMENT '实发工资',
  `signature` varchar(100) DEFAULT NULL COMMENT '签名',
  `total_payout` decimal(8,2) DEFAULT '0.00' COMMENT '总支出',
  `flu_remark` varchar(200) DEFAULT NULL COMMENT '备注',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1已应用）',
  `operator_id` bigint NOT NULL COMMENT '操作人员',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`salary_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5193 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工资表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_salary_copy1`
--

DROP TABLE IF EXISTS `wb_salary_copy1`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_salary_copy1` (
  `salary_id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `salary_month` varchar(7) NOT NULL COMMENT '发薪月份',
  `sn` bigint DEFAULT NULL COMMENT '序号',
  `employee_id` bigint DEFAULT NULL COMMENT '员工ID',
  `employee_name` varchar(50) NOT NULL COMMENT '姓名',
  `work_days` decimal(4,2) DEFAULT NULL COMMENT '全勤天数',
  `att_days` decimal(4,2) DEFAULT NULL COMMENT '出勤天数',
  `sick_days` decimal(4,2) DEFAULT NULL COMMENT '病假天数',
  `leave_days` decimal(4,2) DEFAULT NULL COMMENT '事假天数',
  `other_days` decimal(4,2) DEFAULT NULL COMMENT '其他天数',
  `base_salary` decimal(8,2) DEFAULT NULL COMMENT '基本工资',
  `rank_salary` decimal(8,2) DEFAULT NULL COMMENT '职级工资',
  `pa_level` varchar(1) DEFAULT NULL COMMENT '绩效等级',
  `float_rate` decimal(4,2) DEFAULT NULL COMMENT '浮动比例',
  `rank_float` decimal(8,2) DEFAULT NULL COMMENT '职级绩效工资',
  `secrecy_subsidy` decimal(8,2) DEFAULT NULL COMMENT '保密津贴',
  `lunch_subsidy` decimal(8,2) DEFAULT NULL COMMENT '午餐补助',
  `comm_subsidy` decimal(8,2) DEFAULT NULL COMMENT '通讯补助',
  `trans_subsidy` decimal(8,2) DEFAULT NULL COMMENT '交通补助',
  `total_salary` decimal(8,2) DEFAULT NULL COMMENT '工资总额',
  `daily_salary` decimal(8,2) DEFAULT NULL COMMENT '日工资',
  `deduction` decimal(8,2) DEFAULT NULL COMMENT '缺勤扣款',
  `other_paid` decimal(8,2) DEFAULT NULL COMMENT '发其他',
  `other_withhold` decimal(8,2) DEFAULT NULL COMMENT '扣其他',
  `payable` decimal(8,2) DEFAULT NULL COMMENT '应发工资',
  `ins_company` decimal(8,2) DEFAULT NULL COMMENT '公司缴纳',
  `ss_personal` decimal(8,2) DEFAULT NULL COMMENT '个人社保',
  `mi_personal` decimal(8,2) DEFAULT NULL COMMENT '个人医保',
  `ui_personal` decimal(8,2) DEFAULT NULL COMMENT '个人失业',
  `hpf_company` decimal(8,2) DEFAULT NULL COMMENT '公司公积金',
  `hpf_personal` decimal(8,2) DEFAULT NULL COMMENT '个人公积金',
  `taxation` decimal(8,2) DEFAULT NULL COMMENT '所得税代扣',
  `legal_withhold` decimal(8,2) DEFAULT NULL COMMENT '代扣缴',
  `actually_paid` decimal(8,2) DEFAULT NULL COMMENT '实发工资',
  `signature` varchar(100) DEFAULT NULL COMMENT '签名',
  `total_payout` decimal(8,2) DEFAULT '0.00' COMMENT '总支出',
  `flu_remark` varchar(200) DEFAULT NULL COMMENT '备注',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1已应用）',
  `operator_id` bigint NOT NULL COMMENT '操作人员',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`salary_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4349 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工资表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_salary_import`
--

DROP TABLE IF EXISTS `wb_salary_import`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_salary_import` (
  `si_id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `sn` bigint DEFAULT NULL COMMENT '序号',
  `employee_id` bigint DEFAULT NULL COMMENT '员工ID',
  `employee_name` varchar(50) NOT NULL COMMENT '姓名',
  `work_days` decimal(4,2) DEFAULT NULL COMMENT '全勤天数',
  `att_days` decimal(4,2) DEFAULT NULL COMMENT '出勤天数',
  `sick_days` decimal(4,2) DEFAULT NULL COMMENT '病假天数',
  `leave_days` decimal(4,2) DEFAULT NULL COMMENT '事假天数',
  `other_days` decimal(4,2) DEFAULT NULL COMMENT '其他天数',
  `base_salary` decimal(8,2) DEFAULT NULL COMMENT '基本工资',
  `rank_salary` decimal(8,2) DEFAULT NULL COMMENT '职级工资',
  `pa_level` varchar(1) DEFAULT NULL COMMENT '绩效等级',
  `float_rate` decimal(4,2) DEFAULT NULL COMMENT '浮动比例',
  `rank_float` decimal(8,2) DEFAULT NULL COMMENT '职级绩效工资',
  `secrecy_subsidy` decimal(8,2) DEFAULT NULL COMMENT '保密津贴',
  `lunch_subsidy` decimal(8,2) DEFAULT NULL COMMENT '午餐补助',
  `comm_subsidy` decimal(8,2) DEFAULT NULL COMMENT '通讯补助',
  `trans_subsidy` decimal(8,2) DEFAULT NULL COMMENT '交通补助',
  `total_salary` decimal(8,2) DEFAULT NULL COMMENT '工资总额',
  `daily_salary` decimal(8,2) DEFAULT NULL COMMENT '日工资',
  `deduction` decimal(8,2) DEFAULT NULL COMMENT '缺勤扣款',
  `other_paid` decimal(8,2) DEFAULT NULL COMMENT '发其他',
  `other_withhold` decimal(8,2) DEFAULT NULL COMMENT '扣其他',
  `payable` decimal(8,2) DEFAULT NULL COMMENT '应发工资',
  `ins_company` decimal(8,2) DEFAULT NULL COMMENT '公司缴纳',
  `ss_personal` decimal(8,2) DEFAULT NULL COMMENT '个人社保',
  `mi_personal` decimal(8,2) DEFAULT NULL COMMENT '个人医保',
  `ui_personal` decimal(8,2) DEFAULT NULL COMMENT '个人失业',
  `hpf_company` decimal(8,2) DEFAULT NULL COMMENT '公司公积金',
  `hpf_personal` decimal(8,2) DEFAULT NULL COMMENT '个人公积金',
  `taxation` decimal(8,2) DEFAULT NULL COMMENT '所得税代扣',
  `legal_withhold` decimal(8,2) DEFAULT NULL COMMENT '代扣缴',
  `actually_paid` decimal(8,2) DEFAULT NULL COMMENT '实发工资',
  `signature` varchar(100) DEFAULT NULL COMMENT '签名',
  `total_payout` decimal(8,2) DEFAULT NULL COMMENT '总支出',
  `flu_remark` varchar(200) DEFAULT NULL COMMENT '备注',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1已应用）',
  PRIMARY KEY (`si_id`)
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工资导入表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_salary_parameter`
--

DROP TABLE IF EXISTS `wb_salary_parameter`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_salary_parameter` (
  `sp_id` bigint NOT NULL AUTO_INCREMENT COMMENT '参数ID',
  `base_salary` decimal(8,2) DEFAULT NULL COMMENT '基础工资',
  `ss_base` decimal(8,2) DEFAULT NULL COMMENT '社保基数',
  `mi_base` decimal(8,2) DEFAULT NULL COMMENT '医保基数',
  `hpf_base` decimal(8,2) DEFAULT NULL COMMENT '公积金基数',
  `trans_subsidy` decimal(8,2) DEFAULT NULL COMMENT '交通补贴',
  `comm_subsidy` decimal(8,2) DEFAULT NULL COMMENT '通讯补贴',
  `lunch_subsidy` decimal(8,2) DEFAULT NULL COMMENT '午餐补贴',
  `start_date` date DEFAULT NULL COMMENT '开始时间',
  `status` char(1) NOT NULL DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `operator_id` bigint NOT NULL COMMENT '操作人员',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`sp_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工资参数表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_solution`
--

DROP TABLE IF EXISTS `wb_solution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_solution` (
  `solution_id` bigint NOT NULL AUTO_INCREMENT COMMENT '解决方案ID',
  `solution_code` varchar(20) NOT NULL COMMENT '编码',
  `solution_name` varchar(40) NOT NULL COMMENT '名称',
  `dept_id` bigint NOT NULL COMMENT '归口部门',
  `start_date` date DEFAULT NULL COMMENT '启动日期',
  `solution_status` char(1) DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `description` varchar(255) DEFAULT NULL COMMENT '描述',
  `archives_id` varchar(36) DEFAULT NULL COMMENT '档案ID',
  `operator_id` bigint NOT NULL COMMENT '用户ID',
  `operate_time` datetime DEFAULT NULL COMMENT '操作时间',
  PRIMARY KEY (`solution_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='解决方案表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wb_system`
--

DROP TABLE IF EXISTS `wb_system`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wb_system` (
  `system_id` bigint NOT NULL AUTO_INCREMENT COMMENT '系统ID',
  `parent_id` bigint DEFAULT NULL COMMENT '关联系统ID',
  `system_name` varchar(255) NOT NULL COMMENT '系统名称',
  `quantity` int NOT NULL DEFAULT '1' COMMENT '数量',
  `description` varchar(255) DEFAULT NULL COMMENT '系统概述',
  `org_id` bigint NOT NULL COMMENT '最终用户ID',
  `contactman_id` bigint DEFAULT NULL COMMENT '用户联系人ID',
  `contract_id` bigint DEFAULT NULL COMMENT '主合同ID',
  `contract_ids` varchar(255) DEFAULT NULL COMMENT '主合同IDs',
  `maint_ids` varchar(255) DEFAULT NULL COMMENT '维保合同',
  `start_date` date DEFAULT NULL COMMENT '起始日期',
  `first_due_date` date DEFAULT NULL COMMENT '免费质保截止日期',
  `last_due_date` date DEFAULT NULL COMMENT '付费质保截止日期',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '合同总额',
  `vaild_amount` decimal(12,2) DEFAULT NULL COMMENT '认定合同额',
  `maint_amount` decimal(12,2) DEFAULT NULL COMMENT '维保合同额',
  `ratio` decimal(6,2) DEFAULT NULL COMMENT '收费比例',
  `object_scale` bigint DEFAULT NULL COMMENT '客体规模',
  `main_body_scale` bigint DEFAULT NULL COMMENT '主体规模',
  `enterprise_scale` bigint DEFAULT NULL COMMENT 'B端用户数量',
  `user_scale` bigint DEFAULT NULL COMMENT '系统用户规模',
  `system_status` char(1) NOT NULL DEFAULT '2' COMMENT '系统状态（0交付 1试运行 2正式运行 9停用）',
  `archives_id` char(36) NOT NULL COMMENT '档案ID',
  `operator_id` bigint NOT NULL COMMENT '操作员ID',
  `operate_time` datetime NOT NULL COMMENT '操作时间',
  PRIMARY KEY (`system_id`),
  UNIQUE KEY `system_name_UNIQUE` (`system_name`)
) ENGINE=InnoDB AUTO_INCREMENT=289 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-16 14:54:58
