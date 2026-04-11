"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X } from "lucide-react";

export interface SortableImage {
  id: string;
  thumbnail: string;
  _blobUrl?: string;
}

interface SortableImageStripProps {
  images: SortableImage[];
  maxImages: number;
  onReorder: (activeId: string, overId: string) => void;
  onRemove: (index: number) => void;
  onPreview: (index: number) => void;
  onAdd: () => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  /** desktop: spinner replaces thumb; mobile: spinner overlays thumb */
  variant?: "desktop" | "mobile";
}

function Spinner() {
  return (
    <svg className="animate-spin text-white/80" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface SortableItemProps {
  img: SortableImage;
  index: number;
  onRemove: (i: number) => void;
  onPreview: (i: number) => void;
  variant: "desktop" | "mobile";
}

function SortableItem({ img, index, onRemove, onPreview, variant }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: img.id,
    disabled: !!img._blobUrl,
  });

  const borderClass = variant === "desktop" ? "border-white/10" : "border-[var(--chrome-border)]";

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    cursor: img._blobUrl ? "default" : "grab",
    touchAction: "none",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="relative inline-block flex-shrink-0"
    >
      {variant === "desktop" && img._blobUrl ? (
        <div className={`h-14 w-14 rounded-lg border ${borderClass} bg-white/5 flex items-center justify-center`}>
          <Spinner />
        </div>
      ) : (
        <>
          <img
            src={img.thumbnail}
            alt={`Reference ${index + 1}`}
            className={`h-14 w-14 rounded-lg object-cover border ${borderClass} transition-opacity ${
              img._blobUrl ? "opacity-40" : "cursor-pointer"
            }`}
            onClick={() => { if (!img._blobUrl) onPreview(index); }}
            draggable={false}
          />
          {variant === "mobile" && img._blobUrl && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg">
              <Spinner />
            </div>
          )}
        </>
      )}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/80 hover:bg-black transition-colors"
        title="Remove image"
      >
        <X size={9} />
      </button>
    </div>
  );
}

export function SortableImageStrip({
  images,
  maxImages,
  onReorder,
  onRemove,
  onPreview,
  onAdd,
  scrollRef,
  variant = "desktop",
}: SortableImageStripProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const atLimit = images.length >= maxImages;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (over && active.id !== over.id) {
      onReorder(active.id as string, over.id as string);
    }
  };

  const activeImage = activeId ? images.find((img) => img.id === activeId) : null;

  const addButtonClass = variant === "desktop"
    ? "flex-shrink-0 h-14 w-14 flex items-center justify-center rounded-lg border border-dashed border-white/15 text-text-secondary/30 hover:border-white/30 hover:text-text-secondary/60 transition-colors"
    : "flex-shrink-0 h-14 w-14 flex items-center justify-center rounded-lg border border-dashed text-text-secondary/30 hover:text-text-secondary/60 transition-colors border-[var(--chrome-border-strong)] hover:border-[var(--chrome-border-strong)]";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={scrollRef ?? null}
        className="ref-image-scroll flex items-center gap-2 overflow-x-scroll pt-2 pb-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--chrome-handle) transparent" }}
        onWheel={scrollRef ? (e) => {
          if (e.deltaY === 0) return;
          e.preventDefault();
          if (scrollRef.current) scrollRef.current.scrollLeft += e.deltaY;
        } : undefined}
      >
        <SortableContext items={images.map((img) => img.id)} strategy={horizontalListSortingStrategy}>
          {images.map((img, i) => (
            <SortableItem
              key={img.id}
              img={img}
              index={i}
              onRemove={onRemove}
              onPreview={onPreview}
              variant={variant}
            />
          ))}
        </SortableContext>
        {!atLimit && (
          <button
            onClick={onAdd}
            className={addButtonClass}
            title="Add reference image"
          >
            <Plus size={16} />
          </button>
        )}
        <span className="text-[10px] text-text-secondary/40 flex-shrink-0 pl-1 whitespace-nowrap">
          {images.length}/{maxImages}
          {atLimit && " — limit reached"}
        </span>
      </div>

      <DragOverlay>
        {activeImage ? (
          <img
            src={activeImage.thumbnail}
            alt="Dragging"
            className="h-14 w-14 rounded-lg object-cover border border-white/20 opacity-90 shadow-xl"
            draggable={false}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
