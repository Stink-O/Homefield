// Client-side persistence. Image history and templates moved server-side long ago;
// what remains here is the small set of things that genuinely belong on the device:
// the last active workspace (localStorage) and draft reference images plus legacy
// history cleanup (IndexedDB, because the payloads are large base64 strings).

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

// ── Last active workspace (localStorage — small string) ──────────────────────

const LAST_WORKSPACE_KEY = "homefield_last_workspace";

/** Returns the last active workspace id. Validation against the server workspace list happens in AppContext after fetch. */
export function getLastWorkspaceId(): string {
  if (typeof window === "undefined") return "main";
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY) ?? "main";
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

      // v6: add dedicated metadata store so metadata reads never touch base64
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
            const meta = { ...cursor.value };
            delete meta.base64;
            delete meta.referenceImageDataUrls;
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

// ── Legacy local history cleanup ───────────────────────────────────────────────

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
