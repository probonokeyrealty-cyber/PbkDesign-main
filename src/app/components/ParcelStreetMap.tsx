import { useEffect, useRef, useState } from 'react';
import { latLngBounds, map, polygon, tileLayer, type LatLngTuple, type Map as LeafletMap } from 'leaflet';
import type { ParcelFeature } from '../utils/phoneDialerApi';
import 'leaflet/dist/leaflet.css';

const streetTiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const attribution = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

interface ParcelStreetMapProps {
  parcels: ParcelFeature[];
  selected?: ParcelFeature;
  busy: boolean;
  onSelect: (parcelId: string) => void;
  onLoadArea?: (bounds: number[]) => void;
}

function toMapCoordinates(parcel: ParcelFeature): LatLngTuple[][][] {
  const areas = parcel.geometry.type === 'Polygon'
    ? [parcel.geometry.coordinates as number[][][]]
    : parcel.geometry.coordinates as number[][][][];
  return areas.map((area) => area.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
}

export function ParcelStreetMap({ parcels, selected, busy, onSelect, onLoadArea }: ParcelStreetMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<LeafletMap | null>(null);
  const focusAfterSelection = useRef('');
  const selectionHandler = useRef({ busy, onSelect });
  const [areaReady, setAreaReady] = useState(false);

  useEffect(() => {
    selectionHandler.current = { busy, onSelect };
  }, [busy, onSelect]);

  useEffect(() => {
    if (!container.current) return;
    const field = map(container.current, { scrollWheelZoom: false, worldCopyJump: true }).setView([39, -98], 4);
    field.attributionControl.setPrefix(false);
    field.on('zoomend', () => setAreaReady(field.getZoom() >= 11));
    tileLayer(import.meta.env.VITE_PBK_DIALER_TILE_URL || streetTiles, {
      attribution,
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(field);
    instance.current = field;
    const resize = new ResizeObserver(() => field.invalidateSize({ pan: false }));
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      field.remove();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const field = instance.current;
    if (!field) return;
    const bounds = latLngBounds([]);
    for (const parcel of parcels) {
      for (const area of toMapCoordinates(parcel)) bounds.extend(latLngBounds(area.flat()));
    }
    if (bounds.isValid()) field.fitBounds(bounds, { padding: [20, 20], maxZoom: 17, animate: false });
  }, [parcels]);

  useEffect(() => {
    const field = instance.current;
    if (!field) return;
    const selectedId = selected?.properties.parcelId;
    const visibleParcels = selected && !parcels.some((parcel) => parcel.properties.parcelId === selectedId)
      ? [...parcels, selected]
      : parcels;
    const shapes = visibleParcels.map((parcel) => {
      const { parcelId, situs } = parcel.properties;
      const active = parcelId === selectedId;
      const shape = polygon(toMapCoordinates(parcel), { className: 'pbk-street-parcel' }).addTo(field);
      const element = shape.getElement();
      const item = element instanceof SVGElement ? element : null;
      if (item) {
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `Parcel ${parcelId}, ${situs.line1}`);
        item.setAttribute('aria-pressed', String(active));
        if (active && focusAfterSelection.current === parcelId) {
          item.focus({ preventScroll: true });
          focusAfterSelection.current = '';
        }
      }
      const select = () => {
        if (!selectionHandler.current.busy) selectionHandler.current.onSelect(parcelId);
      };
      shape.on('click', select);
      item?.addEventListener('keydown', (event) => {
        if ((event.key !== 'Enter' && event.key !== ' ') || selectionHandler.current.busy) return;
        event.preventDefault();
        event.stopPropagation();
        focusAfterSelection.current = parcelId;
        select();
      });
      if (active && !field.getBounds().contains(shape.getBounds().getCenter())) {
        field.fitBounds(shape.getBounds(), { padding: [32, 32], maxZoom: 17, animate: false });
      }
      return shape;
    });
    return () => { shapes.forEach((shape) => shape.remove()); };
  }, [parcels, selected]);

  return (
    <>
      <div ref={container} className="pbk-dialer-street-map" role="group" aria-label="OpenStreetMap streets and interactive parcel boundaries" />
      {onLoadArea && (
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-dialer-map-area" disabled={busy || !areaReady}
          onClick={() => {
            const field = instance.current;
            if (!field) return;
            const bounds = field.getBounds();
            onLoadArea([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
          }}>
          {areaReady ? 'Load parcels here' : 'Zoom in to load parcels'}
        </button>
      )}
    </>
  );
}
