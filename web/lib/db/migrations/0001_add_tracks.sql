CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`model` text NOT NULL,
	`file_path` text NOT NULL,
	`mime_type` text DEFAULT 'audio/mpeg' NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracks_user_id_idx` ON `tracks` (`user_id`);
