CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes` text DEFAULT '["generate"]' NOT NULL,
	`destination_mode` text DEFAULT 'own' NOT NULL,
	`default_workspace_id` text,
	`max_quality` text,
	`max_model` text,
	`daily_image_limit` integer,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE INDEX `api_keys_user_id_idx` ON `api_keys` (`user_id`);
--> statement-breakpoint
CREATE INDEX `api_keys_key_hash_idx` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE TABLE `api_key_usage` (
	`key_id` text NOT NULL,
	`day` text NOT NULL,
	`image_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key_id`, `day`),
	FOREIGN KEY (`key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_key` text,
	`access` text DEFAULT 'shared' NOT NULL,
	`client_email` text,
	`project_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `images` ADD COLUMN `origin` text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE `images` ADD COLUMN `agent_key_id` text REFERENCES `api_keys`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `images` ADD COLUMN `agent_label` text;
--> statement-breakpoint
CREATE INDEX `images_origin_idx` ON `images` (`origin`);
