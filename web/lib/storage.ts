import { GeneratedImage, GeneratedImageMeta, Workspace } from "./types";

const API_KEY_STORAGE = "homefield_api_key";
const WORKSPACES_STORAGE = "homefield_workspaces";
const DEFAULT_WORKSPACE: Workspace = { id: "main", name: "Main", createdAt: 0 };
const DB_NAME = "homefield_db";
const DB_VERSION = 6;
const STORE_NAME = "images";
const DRAFT_STORE = "draft";
const USER_TEMPLATES_STORE = "user_templates";
const META_STORE_NAME = "image_meta";

export interface UserTemplate {
  id: string;
  title: string;
  description: string;
  content: string;
  thumbnail: string; // data URL
  createdAt: number;
}

// ── API Key (localStorage — small string, fine here) ─────────────────────────

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function removeApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE);
}

// ── Workspaces (localStorage — small data, fine here) ────────────────────────

export function getWorkspaces(): Workspace[] {
  if (typeof window === "undefined") return [DEFAULT_WORKSPACE];
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_WORKSPACE];
  } catch {
    return [DEFAULT_WORKSPACE];
  }
}

export function saveWorkspaces(workspaces: Workspace[]): void {
  localStorage.setItem(WORKSPACES_STORAGE, JSON.stringify(workspaces));
}

const LAST_WORKSPACE_KEY = "homefield_last_workspace";

/** Returns the last active workspace id, validated against the stored workspace list. */
export function getLastWorkspaceId(): string {
  if (typeof window === "undefined") return "main";
  try {
    const saved = localStorage.getItem(LAST_WORKSPACE_KEY);
    if (!saved) return "main";
    const workspaces = getWorkspaces();
    return workspaces.some((w) => w.id === saved) ? saved : "main";
  } catch {
    return "main";
  }
}

export function saveLastWorkspaceId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LAST_WORKSPACE_KEY, id);
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

// Singleton promise so every caller shares the same upgraded connection.
// Without this, concurrent open() calls at the old version block each other
// from running onupgradeneeded, leaving new stores permanently missing.
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const upgradeTransaction = (e.target as IDBOpenDBRequest).transaction!;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(USER_TEMPLATES_STORE)) {
        const tStore = db.createObjectStore(USER_TEMPLATES_STORE, { keyPath: "id" });
        tStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      // v6: add dedicated metadata store so getHistoryMeta never touches base64
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        const metaStore = db.createObjectStore(META_STORE_NAME, { keyPath: "id" });
        metaStore.createIndex("timestamp", "timestamp", { unique: false });

        // Migrate existing records from the images store into the meta store
        if (db.objectStoreNames.contains(STORE_NAME)) {
          const imgStore = upgradeTransaction.objectStore(STORE_NAME);
          const cursorReq = imgStore.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const { base64: _b, referenceImageDataUrls: _r, ...meta } = cursor.value;
            const putReq = metaStore.put(meta);
            putReq.onerror = () => console.error("[HomeField] IndexedDB v6 migration: failed to migrate record", meta.id, putReq.error);
            cursor.continue();
          };
          cursorReq.onerror = () => console.error("[HomeField] IndexedDB v6 migration: cursor error", cursorReq.error);
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the DB, reset the singleton so we re-open cleanly.
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };

    request.onerror  = () => { _dbPromise = null; reject(request.error); };
    request.onblocked = () => console.warn("[HomeField] IndexedDB upgrade blocked — close other tabs and reload");
  });

  return _dbPromise;
}

// ── Image History (IndexedDB — handles large base64 payloads) ─────────────────

export async function getHistory(): Promise<GeneratedImage[]> {
  if (typeof window === "undefined") return [];
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("timestamp");
      const request = index.getAll();
      request.onsuccess = () => {
        const items = (request.result as GeneratedImage[]).sort(
          (a, b) => b.timestamp - a.timestamp
        );
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

// Returns metadata-only records by reading the dedicated meta store.
// base64 is never deserialized — zero allocation spike on load.
export async function getHistoryMeta(
  workspaceId: string,
  limit: number,
  beforeTimestamp?: number
): Promise<{ items: GeneratedImageMeta[]; hasMore: boolean }> {
  if (typeof window === "undefined") return { items: [], hasMore: false };
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, "readonly");
      const index = tx.objectStore(META_STORE_NAME).index("timestamp");

      const upperBound = beforeTimestamp !== undefined
        ? IDBKeyRange.upperBound(beforeTimestamp, true)
        : undefined;
      const request = index.openCursor(upperBound ?? null, "prev");

      const results: GeneratedImageMeta[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve({ items: results, hasMore: false });
          return;
        }

        const record = cursor.value as GeneratedImageMeta;
        const recordWorkspace = record.workspaceId ?? "main";

        if (recordWorkspace === workspaceId) {
          if (results.length < limit) {
            results.push(record);
            if (results.length === limit) {
              cursor.continue();
              return;
            }
          } else {
            resolve({ items: results, hasMore: true });
            return;
          }
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  } catch {
    return { items: [], hasMore: false };
  }
}

export async function getImageById(id: string): Promise<GeneratedImage | null> {
  if (typeof window === "undefined") return null;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function addToHistory(image: GeneratedImage): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).put(image);
    const { base64: _b, referenceImageDataUrls: _r, ...meta } = image;
    tx.objectStore(META_STORE_NAME).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearHistory(): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(META_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteFromHistory(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.objectStore(META_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateImageWorkspace(id: string, workspaceId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const imgStore = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(META_STORE_NAME);
    const getReq = imgStore.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return;
      const updated = { ...record, workspaceId };
      imgStore.put(updated);
      const { base64: _b, referenceImageDataUrls: _r, ...meta } = updated;
      metaStore.put(meta);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Returns all image IDs for a workspace by reading only the meta store — no base64 loaded.
async function getIdsByWorkspace(workspaceId: string): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const index = tx.objectStore(META_STORE_NAME).index("timestamp");
    const ids: string[] = [];
    const request = index.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(ids); return; }
      const record = cursor.value as GeneratedImageMeta;
      if ((record.workspaceId ?? "main") === workspaceId) ids.push(record.id);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteImagesByWorkspace(workspaceId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const ids = await getIdsByWorkspace(workspaceId);
  if (!ids.length) return;
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(META_STORE_NAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    for (const id of ids) {
      store.delete(id);
      metaStore.delete(id);
    }
  });
}

// ── Draft reference images (IndexedDB — handles large base64 payloads) ────────

export async function saveDraftImages(images: { base64: string; mimeType: string; thumbnail: string }[]): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, "readwrite");
    const request = tx.objectStore(DRAFT_STORE).put({ key: "referenceImages", images });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadDraftImages(): Promise<{ base64: string; mimeType: string; thumbnail: string }[]> {
  if (typeof window === "undefined") return [];
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, "readonly");
      const request = tx.objectStore(DRAFT_STORE).get("referenceImages");
      request.onsuccess = () => resolve(request.result?.images ?? []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

// ── User Templates (IndexedDB — thumbnails can be large base64 payloads) ─────

export async function getUserTemplates(): Promise<UserTemplate[]> {
  if (typeof window === "undefined") return [];
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(USER_TEMPLATES_STORE, "readonly");
      const index = tx.objectStore(USER_TEMPLATES_STORE).index("createdAt");
      const request = index.getAll();
      request.onsuccess = () => {
        const items = (request.result as UserTemplate[]).sort((a, b) => b.createdAt - a.createdAt);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function saveUserTemplate(template: UserTemplate): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(USER_TEMPLATES_STORE, "readwrite");
    const request = tx.objectStore(USER_TEMPLATES_STORE).put(template);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteUserTemplate(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(USER_TEMPLATES_STORE, "readwrite");
    const request = tx.objectStore(USER_TEMPLATES_STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearHistoryForWorkspace(workspaceId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const ids = await getIdsByWorkspace(workspaceId);
  if (!ids.length) return;
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(META_STORE_NAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    for (const id of ids) {
      store.delete(id);
      metaStore.delete(id);
    }
  });
}
