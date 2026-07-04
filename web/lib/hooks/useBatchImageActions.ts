"use client";

import { useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import { deleteFromHistory } from "@/lib/storage";

// Batch actions for the private gallery: delete, copy/move between
// workspaces, and zip download. Backed by the images API.
export function useBatchImageActions() {
  const { state, dispatch } = useApp();

  const handleBatchDelete = useCallback((ids: string[]) => {
    for (const id of ids) {
      fetch(`/api/images/${id}`, { method: "DELETE" })
        .then((res) => { if (!res.ok) console.error(`[HomeField] Failed to delete image ${id}: ${res.status}`); })
        .catch(() => console.error(`[HomeField] Network error deleting image ${id}`));
      dispatch({ type: "DELETE_IMAGE", payload: id });
      deleteFromHistory(id).catch(() => {});
    }
  }, [dispatch]);

  const handleBatchCopyTo = useCallback(async (ids: string[], targetWorkspaceId: string) => {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/images/${id}/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetWorkspaceId }),
        })
      )
    );
  }, []);

  const handleBatchMoveTo = useCallback(async (ids: string[], targetWorkspaceId: string) => {
    await Promise.all(ids.map((id) =>
      fetch(`/api/images/${id}/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: targetWorkspaceId }),
      })
    ));
    dispatch({ type: "REMOVE_MANY_FROM_VIEW", payload: ids });
  }, [dispatch]);

  const handleBatchDownload = useCallback(async (ids: string[]) => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    for (const id of ids) {
      const image = state.history.find((img) => img.id === id);
      if (!image) continue;
      const res = await fetch(`/api/images/${id}/download`);
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      const slug = image.prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
      const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
      zip.file(`${slug}_${id.slice(0, 6)}.${ext}`, buffer);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `homefield_${ids.length}_images.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }, [state.history]);

  return { handleBatchDelete, handleBatchCopyTo, handleBatchMoveTo, handleBatchDownload };
}
