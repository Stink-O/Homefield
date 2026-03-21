export interface ImageEvent {
  id: string;
  jobId: string;
  userId: string;
  workspaceId: string | null;
  prompt: string;
  model: string;
  aspectRatio: string;
  selectedAspectRatio: string;
  quality: string | null;
  width: number;
  height: number;
  thumbnailUrl: string;
  mimeType: string;
  timestamp: number;
  searchGrounding: boolean;
  referenceImageDataUrls?: string[];
}

export interface PendingStartEvent {
  _eventKind: "pending_start";
  jobId: string;
  clientId?: string; // client-generated ID echoed back so the originating tab can skip it
  userId: string;
  workspaceId: string | null;
  prompt: string;
  model: string;
  aspectRatio: string;
  selectedAspectRatio: string;
  quality: string | null;
  startedAt: number;
}

export interface PendingEndEvent {
  _eventKind: "pending_end";
  jobId: string;
  userId: string;
}

export interface PendingProcessingEvent {
  _eventKind: "pending_processing";
  jobId: string;
  userId: string;
}

export interface ImageDeleteEvent {
  _eventKind: "image_deleted";
  imageId: string;
  userId: string;
}

export type StreamEvent = ImageEvent | PendingStartEvent | PendingEndEvent | PendingProcessingEvent | ImageDeleteEvent;

declare global {
  // eslint-disable-next-line no-var
  var __hf_image_subscribers: Map<string, Set<(event: StreamEvent) => void>> | undefined;
}

if (!globalThis.__hf_image_subscribers) {
  globalThis.__hf_image_subscribers = new Map();
}

export function subscribeToImages(userId: string, fn: (e: StreamEvent) => void): () => void {
  const subs = globalThis.__hf_image_subscribers!;
  if (!subs.has(userId)) subs.set(userId, new Set());
  subs.get(userId)!.add(fn);
  return () => {
    subs.get(userId)?.delete(fn);
    if (subs.get(userId)?.size === 0) subs.delete(userId);
  };
}

function broadcast(userId: string, event: StreamEvent): void {
  const subs = globalThis.__hf_image_subscribers?.get(userId);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(event);
    } catch {
      // Subscriber is dead (e.g. abrupt disconnect); remove it to prevent a leak.
      subs.delete(fn);
      if (subs.size === 0) globalThis.__hf_image_subscribers!.delete(userId);
    }
  }
}

export function broadcastImage(userId: string, event: ImageEvent): void {
  // TEMP DEBUG — remove after confirming cross-device sync works
  const subs = globalThis.__hf_image_subscribers?.get(userId);
  console.log(`[HF broadcast:private] userId=${userId.slice(0, 8)} subscribers=${subs?.size ?? 0} workspaceId=${event.workspaceId}`);
  broadcast(userId, event);
}

export function broadcastPendingStart(userId: string, event: PendingStartEvent): void {
  broadcast(userId, event);
}

export function broadcastPendingEnd(userId: string, jobId: string): void {
  broadcast(userId, { _eventKind: "pending_end", jobId, userId });
}

export function broadcastPendingProcessing(userId: string, jobId: string): void {
  broadcast(userId, { _eventKind: "pending_processing", jobId, userId });
}

export function broadcastImageDelete(userId: string, imageId: string): void {
  broadcast(userId, { _eventKind: "image_deleted", imageId, userId });
}
