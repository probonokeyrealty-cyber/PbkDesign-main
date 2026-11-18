import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';

type Props = {
  photos: string[];
  photo: string;
  imageSrc: string;
  trigger: ReactElement;
  preview: boolean;
  onSelect: (photo: string) => void;
  onLoad: (source: string, width: number) => void;
  onError: (photo: string, source: string) => void;
};

export function PropertyPhotoViewer(props: Props) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{props.trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="pbk-photo-viewer-backdrop" />
        <ViewerContent {...props} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ViewerContent({ photos, photo, imageSrc, preview, onSelect, onLoad, onError }: Props) {
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const previousZoom = useRef(1);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const index = Math.max(0, photos.indexOf(photo));

  useLayoutEffect(() => {
    setZoom(1);
    drag.current = null;
    setDragging(false);
    previousZoom.current = 1;
    viewport.current?.scrollTo(0, 0);
  }, [photo]);

  useLayoutEffect(() => {
    const area = viewport.current;
    if (area) {
      const ratio = zoom / previousZoom.current;
      area.scrollLeft = (area.scrollLeft + area.clientWidth / 2) * ratio - area.clientWidth / 2;
      area.scrollTop = (area.scrollTop + area.clientHeight / 2) * ratio - area.clientHeight / 2;
    }
    previousZoom.current = zoom;
  }, [zoom]);

  const zoomBy = (amount: number) => setZoom((value) => Math.max(1, Math.min(4, value + amount)));
  const move = (direction: number) => {
    if (photos.length > 1) onSelect(photos[(index + direction + photos.length) % photos.length]);
  };

  return (
    <Dialog.Content
      className="pbk-photo-viewer"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(1);
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoomBy(0.25);
        } else if (event.key === '-') {
          event.preventDefault();
          zoomBy(-0.25);
        } else if (event.key === '0') {
          event.preventDefault();
          setZoom(1);
        }
      }}
    >
      <header className="pbk-photo-viewer-header">
        <Dialog.Title>Property photos</Dialog.Title>
        <span className="pbk-photo-viewer-count" aria-live="polite">
          {index + 1} / {photos.length}
        </span>
        <Dialog.Close asChild>
          <button type="button" className="pbk-btn pbk-btn-ghost" aria-label="Close photo viewer">
            <X size={20} aria-hidden />
          </button>
        </Dialog.Close>
      </header>
      <div className="pbk-photo-viewer-stage">
        <div
          ref={viewport}
          className="pbk-photo-viewer-viewport"
          role="region"
          aria-label="Photo zoom area"
          tabIndex={0}
          data-zoomed={zoom > 1}
          data-dragging={dragging}
          onPointerDown={(event) => {
            if (zoom <= 1 || event.pointerType !== 'mouse' || event.button !== 0) return;
            event.preventDefault();
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
            event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          <div
            className="pbk-photo-viewer-canvas"
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <img
              key={imageSrc}
              src={imageSrc}
              alt={`Property photo ${index + 1} of ${photos.length}`}
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={(event) => onLoad(imageSrc, event.currentTarget.naturalWidth)}
              onError={() => onError(photo, imageSrc)}
            />
          </div>
        </div>
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-photo-viewer-prev"
          aria-label="Previous photo"
          disabled={photos.length < 2}
          onClick={() => move(-1)}
        >
          <ChevronLeft size={24} aria-hidden />
        </button>
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-photo-viewer-next"
          aria-label="Next photo"
          disabled={photos.length < 2}
          onClick={() => move(1)}
        >
          <ChevronRight size={24} aria-hidden />
        </button>
      </div>
      <footer className="pbk-photo-viewer-footer">
        <div className="pbk-photo-viewer-zoom" role="group" aria-label="Photo zoom controls">
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost"
            aria-label="Zoom out"
            aria-disabled={zoom <= 1}
            tabIndex={zoom <= 1 ? -1 : 0}
            onClick={() => zoomBy(-0.25)}
          >
            <Minus size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost"
            aria-label="Reset zoom"
            onClick={() => setZoom(1)}
          >
            <output aria-label="Zoom level" aria-live="polite">
              {Math.round(zoom * 100)}%
            </output>
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost"
            aria-label="Zoom in"
            aria-disabled={zoom >= 4}
            tabIndex={zoom >= 4 ? -1 : 0}
            onClick={() => zoomBy(0.25)}
          >
            <Plus size={18} aria-hidden />
          </button>
        </div>
        <Dialog.Description>
          Arrow keys change photos. + / − zoom, 0 fits the screen, Esc closes. Drag or scroll to pan
          when zoomed.
        </Dialog.Description>
        {preview && (
          <p className="pbk-property-evidence-note">
            Low-resolution source preview. Open the listing for more detail.
          </p>
        )}
      </footer>
    </Dialog.Content>
  );
}
