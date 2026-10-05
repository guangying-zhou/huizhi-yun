USE `hzy_people`;

CREATE TABLE `people_ranks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rank_code` VARCHAR(32) NOT NULL,
  `rank_name` VARCHAR(100) NOT NULL,
  `rank_level` INT NOT NULL DEFAULT 0,
  `description` VARCHAR(255) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_rank_code` (`rank_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `people_ranks` (`rank_code`, `rank_name`, `rank_level`, `enabled`, `sort_order`)
VALUES ('G6', '高级工程师', 6, 1, 60);
