import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  approved: integer("approved", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  selectedAspectRatio: text("selected_aspect_ratio"),
  quality: text("quality"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  filePath: text("file_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  mimeType: text("mime_type").notNull(),
  timestamp: integer("timestamp").notNull(),
  isShared: integer("is_shared", { mode: "boolean" }).notNull().default(false),
  searchGrounding: integer("search_grounding", { mode: "boolean" }),
  referenceImagePaths: text("reference_image_paths"),
}, (t) => ({
  workspaceIdIdx: index("images_workspace_id_idx").on(t.workspaceId),
  userIdIdx: index("images_user_id_idx").on(t.userId),
}));

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  content: text("content").notNull(),
  thumbnailPath: text("thumbnail_path"),
  createdAt: integer("created_at").notNull(),
});

export const templateFavourites = sqliteTable("template_favourites", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.templateId] }),
}));

export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull().default("audio/mpeg"),
  timestamp: integer("timestamp").notNull(),
  lyrics: text("lyrics"),
  description: text("description"),
}, (t) => ({
  userIdIdx: index("tracks_user_id_idx").on(t.userId),
}));
