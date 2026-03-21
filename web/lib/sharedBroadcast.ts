export interface SharedImageEvent {
  _eventKind?: never;
  id: string;
  jobId: string;       // server job ID — lets clients remove their pending shimmer
  userId: string;
  username: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  quality: string | null;
  width: number;
  height: number;
  thumbnailUrl: string;
  timestamp: number;
  referenceImageDataUrls?: string[];
}

export interface SharedPendingStartEvent {
  _eventKind: "shared_pending_start";
  jobId: string;
  clientId?: string; // echoed back so the generating tab can suppress its own duplicate shimmer
  userId: string;
  username: string;
  prompt: string;
  aspectRatio: string;
  startedAt: number;
}

export interface SharedPendingEndEvent {
  _eventKind: "shared_pending_end";
  jobId: string;
}

export type SharedStreamEvent = SharedImageEvent | SharedPendingStartEvent | SharedPendingEndEvent;

declare global {
  // eslint-disable-next-line no-var
  var __hf_shared_subscribers: Set<(event: SharedStreamEvent) => void> | undefined;
}

if (!globalThis.__hf_shared_subscribers) {
  globalThis.__hf_shared_subscribers = new Set();
}

export function subscribeToShared(fn: (e: SharedStreamEvent) => void): () => void {
  globalThis.__hf_shared_subscribers!.add(fn);
  return () => globalThis.__hf_shared_subscribers!.delete(fn);
}

function broadcast(event: SharedStreamEvent): void {
  const subs = globalThis.__hf_shared_subscribers!;
  for (const fn of subs) {
    try {
      fn(event);
    } catch {
      // Subscriber is dead (e.g. abrupt disconnect); remove it to prevent a leak.
      subs.delete(fn);
    }
  }
}

export function broadcastShared(event: SharedImageEvent): void {
  // TEMP DEBUG — remove after confirming cross-device sync works
  console.log(`[HF broadcast:shared] subscribers=${globalThis.__hf_shared_subscribers?.size ?? 0}`);
  broadcast(event);
}

export function broadcastSharedPendingStart(event: SharedPendingStartEvent): void {
  broadcast(event);
}

export function broadcastSharedPendingEnd(jobId: string): void {
  broadcast({ _eventKind: "shared_pending_end", jobId });
}
