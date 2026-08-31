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

// Agent API keys. One row per agent identity. The key itself is never stored —
// only a SHA-256 hash and a short display prefix. Destination and scope rules
// live here rather than on each call so an agent cannot argue its way past them.
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  // JSON array of scope strings: "generate" | "delete" | "publish" | "templates"
  scopes: text("scopes").notNull().default('["generate"]'),
  destinationMode: text("destination_mode", { enum: ["own", "pinned", "any"] })
    .notNull().default("own"),
  defaultWorkspaceId: text("default_workspace_id")
    .references(() => workspaces.id, { onDelete: "set null" }),
  // Spend ceilings. NULL maxQuality/maxModel means "no restriction".
  maxQuality: text("max_quality"),
  maxModel: text("max_model"),
  dailyImageLimit: integer("daily_image_limit"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  expiresAt: integer("expires_at"),
  revokedAt: integer("revoked_at"),
}, (t) => ({
  userIdIdx: index("api_keys_user_id_idx").on(t.userId),
  keyHashIdx: index("api_keys_key_hash_idx").on(t.keyHash),
}));

// Rolling per-key usage counter, one row per key per UTC day. Enforces
// dailyImageLimit without scanning the images table on every generation.
export const apiKeyUsage = sqliteTable("api_key_usage", {
  keyId: text("key_id").notNull().references(() => apiKeys.id, { onDelete: "cascade" }),
  day: text("day").notNull(), // YYYY-MM-DD, UTC
  imageCount: integer("image_count").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.keyId, t.day] }),
}));

// Per-user Google service-account credentials, encrypted with the same
// AES-256-GCM scheme as the instance key (see lib/credentialStore.ts).
// access: "own" = bill to this row's key, "shared" = admin granted use of the
// instance key, "none" = cannot generate.
export const userCredentials = sqliteTable("user_credentials", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  encryptedKey: text("encrypted_key"),
  access: text("access", { enum: ["own", "shared", "none"] }).notNull().default("shared"),
  clientEmail: text("client_email"),
  projectId: text("project_id"),
  updatedAt: integer("updated_at").notNull(),
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
  // Provenance. agentLabel is a denormalized snapshot of the key's name so the
  // badge survives the key being revoked or deleted.
  origin: text("origin", { enum: ["user", "agent"] }).notNull().default("user"),
  agentKeyId: text("agent_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  agentLabel: text("agent_label"),
}, (t) => ({
  workspaceIdIdx: index("images_workspace_id_idx").on(t.workspaceId),
  userIdIdx: index("images_user_id_idx").on(t.userId),
  originIdx: index("images_origin_idx").on(t.origin),
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

// Instance-wide key/value config. Values may be encrypted at rest (e.g. the
// Google service-account JSON is stored as an AES-256-GCM payload). See
// lib/credentialStore.ts.
export const appConfig = sqliteTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
