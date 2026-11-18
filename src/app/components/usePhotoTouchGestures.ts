import { useCallback, useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';

export type PhotoZoomAnchor = { contentX: number; contentY: number; x: number; y: number };
type Point = { x: number; y: number };
type Single = Point & { id: number; left: number; top: number; time: number; zoom: number; moved: boolean; vertical: boolean; horizontal: boolean };
type Pinch = { distance: number; zoom: number; contentX: number; contentY: number };
type Options = {
  viewport: RefObject<HTMLDivElement | null>;
  photo: string;
  zoom: number;
  onZoom: (zoom: number, anchor: PhotoZoomAnchor) => void;
  onMove: (direction: number) => void;
  onClose: () => void;
};

export function usePhotoTouchGestures({ viewport, photo, zoom, onZoom, onMove, onClose }: Options) {
  const contacts = useRef(new Map<number, Point>());
  const single = useRef<Single | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const hadMultiple = useRef(false);
  const lastTap = useRef<(Point & { time: number }) | null>(null);

  const clear = useCallback(() => {
    contacts.current.clear();
    single.current = null;
    pinch.current = null;
    hadMultiple.current = false;
    lastTap.current = null;
  }, []);
  useLayoutEffect(clear, [photo, clear]);
  useLayoutEffect(() => {
    if (contacts.current.size < 2) {
      single.current = null;
      lastTap.current = null;
    }
  }, [zoom]);

  const geometry = () => {
    const [a, b] = [...contacts.current.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const anchorAt = (area: HTMLDivElement, x: number, y: number) => {
    const rect = area.getBoundingClientRect();
    return { x: x - rect.x, y: y - rect.y };
  };
  const beginPinch = (area: HTMLDivElement) => {
    const g = geometry();
    if (g.distance < 8) return;
    const p = anchorAt(area, g.x, g.y);
    pinch.current = { distance: g.distance, zoom, contentX: (area.scrollLeft + p.x) / zoom, contentY: (area.scrollTop + p.y) / zoom };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // After cancellation/extra contacts, only a fresh primary touch can restart.
    if (contacts.current.size === 0 && !event.isPrimary) return;
    contacts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (contacts.current.size > 2) { clear(); return; }
    if (contacts.current.size === 2) {
      hadMultiple.current = true;
      single.current = null;
      lastTap.current = null;
      beginPinch(event.currentTarget);
    } else {
      single.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, time: event.timeStamp, zoom, moved: false, vertical: false, horizontal: false };
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!contacts.current.has(event.pointerId)) return;
    contacts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (contacts.current.size === 2) {
      if (!pinch.current) beginPinch(event.currentTarget);
      const start = pinch.current;
      if (!start) return;
      const g = geometry(), p = anchorAt(event.currentTarget, g.x, g.y);
      onZoom(start.zoom * g.distance / start.distance, { contentX: start.contentX, contentY: start.contentY, ...p });
      return;
    }
    const start = single.current;
    if (!start || hadMultiple.current || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 10) { start.moved = true; lastTap.current = null; }
    if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) start.vertical = true;
    if (Math.abs(dx) > 12 && Math.abs(dx) >= Math.abs(dy)) start.horizontal = true;
    if (start.zoom > 1) {
      event.currentTarget.scrollLeft = start.left - dx;
      event.currentTarget.scrollTop = start.top - dy;
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!contacts.current.has(event.pointerId)) return;
    contacts.current.delete(event.pointerId);
    pinch.current = null;
    const start = single.current;
    single.current = null;
    if (contacts.current.size > 0) { clear(); return; }
    const multiple = hadMultiple.current;
    hadMultiple.current = false;
    if (!start || multiple || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y, now = event.timeStamp;
    if (!start.moved && Math.hypot(dx, dy) <= 10 && now - start.time <= 250) {
      const tap = lastTap.current;
      if (tap && now - tap.time <= 300 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 32) {
        lastTap.current = null;
        const area = viewport.current;
        if (!area) return;
        const p = anchorAt(area, event.clientX, event.clientY);
        onZoom(zoom > 1 ? 1 : 2, { contentX: (area.scrollLeft + p.x) / zoom, contentY: (area.scrollTop + p.y) / zoom, ...p });
      } else lastTap.current = { x: event.clientX, y: event.clientY, time: now };
    } else {
      lastTap.current = null;
      if (start.zoom === 1 && zoom === 1) {
        if (!start.horizontal && dy >= 80 && dy > Math.abs(dx) * 1.5) onClose();
        else if (!start.vertical && Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5)
          onMove(dx < 0 ? 1 : -1);
      }
    }
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: clear };
}
