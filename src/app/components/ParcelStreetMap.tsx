import { useEffect, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import mapboxgl, { type GeoJSONSource } from 'mapbox-gl';
import type { ParcelFeature } from '../utils/phoneDialerApi';
import { mapboxPublicToken, mapboxStreetStyle } from '../utils/mapboxConfig';
import 'mapbox-gl/mapbox-gl.css';

interface ParcelStreetMapProps {
  parcels: ParcelFeature[];
  selected?: ParcelFeature;
  busy: boolean;
  fitParcels: boolean;
  onSelect: (parcelId: string) => void;
  onLoadArea?: (bounds: number[]) => void;
  onUnavailable: () => void;
}

function parcelBounds({ geometry }: ParcelFeature) {
  const bounds = new mapboxgl.LngLatBounds();
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as number[][][]]
      : (geometry.coordinates as number[][][][]);
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0] ?? []) bounds.extend([lng, lat]);
  }
  return bounds;
}

export function ParcelStreetMap({
  parcels,
  selected,
  busy,
  fitParcels,
  onSelect,
  onLoadArea,
  onUnavailable,
}: ParcelStreetMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<mapboxgl.Map | null>(null);
  const fittedParcels = useRef<ParcelFeature[] | null>(null);
  const focusedParcel = useRef('');
  const selection = useRef({ busy, onSelect });
  const [ready, setReady] = useState(false);
  const [areaReady, setAreaReady] = useState(false);

  useEffect(() => {
    selection.current = { busy, onSelect };
  }, [busy, onSelect]);

  useEffect(() => {
    if (!container.current) return;
    if (!mapboxPublicToken) {
      onUnavailable();
      return;
    }
    let field: mapboxgl.Map;
    try {
      field = new mapboxgl.Map({
        container: container.current,
        accessToken: mapboxPublicToken,
        style: mapboxStreetStyle,
        center: [-98, 39],
        zoom: 4,
        scrollZoom: false,
        dragRotate: false,
        pitchWithRotate: false,
        cooperativeGestures: true,
        renderWorldCopies: false,
        performanceMetricsCollection: false,
      });
    } catch {
      onUnavailable();
      return;
    }
    instance.current = field;
    field.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
    field.addControl(
      new mapboxgl.FullscreenControl({ container: container.current.parentElement ?? undefined })
    );
    field.touchZoomRotate.disableRotation();
    const timeout = window.setTimeout(onUnavailable, 15_000);
    field.on('error', ({ error }) => {
      if ('status' in error && (error.status === 401 || error.status === 403)) onUnavailable();
    });
    field.on('zoomend', () => setAreaReady(field.getZoom() >= 11));
    field.once('load', () => {
      window.clearTimeout(timeout);
      const accents = getComputedStyle(field.getContainer());
      const sky = accents.getPropertyValue('--sky-deep').trim();
      const selectedSky = accents.getPropertyValue('--sky-bright').trim();
      field.addSource('parcel-boundaries', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      field.addLayer({
        id: 'parcel-fill',
        type: 'fill',
        source: 'parcel-boundaries',
        paint: {
          'fill-color': ['case', ['get', 'selected'], selectedSky, sky],
          'fill-opacity': ['case', ['get', 'selected'], 0.48, 0.2],
        },
      });
      field.addLayer({
        id: 'parcel-outline',
        type: 'line',
        source: 'parcel-boundaries',
        paint: {
          'line-color': sky,
          'line-width': ['case', ['get', 'selected'], 3, 2],
        },
      });
      field.on('click', 'parcel-fill', (event) => {
        const id = event.features?.[0]?.properties?.parcelId;
        if (typeof id === 'string' && !selection.current.busy) selection.current.onSelect(id);
      });
      field.on('mouseenter', 'parcel-fill', () => {
        field.getCanvas().style.cursor = 'pointer';
      });
      field.on('mouseleave', 'parcel-fill', () => {
        field.getCanvas().style.cursor = '';
      });
      setReady(true);
    });
    const resize = new ResizeObserver(() => field.resize());
    resize.observe(container.current);
    return () => {
      window.clearTimeout(timeout);
      resize.disconnect();
      field.remove();
      instance.current = null;
      fittedParcels.current = null;
    };
  }, [onUnavailable]);

  useEffect(() => {
    const field = instance.current;
    if (!ready || !field) return;
    const source = field.getSource<GeoJSONSource>('parcel-boundaries');
    if (!source) return;
    const selectedId = selected?.properties.parcelId;
    const visible =
      selected && !parcels.some((parcel) => parcel.properties.parcelId === selectedId)
        ? [...parcels, selected]
        : parcels;
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: visible.map(({ geometry, properties }) => ({
        type: 'Feature',
        geometry:
          geometry.type === 'Polygon'
            ? { type: 'Polygon', coordinates: geometry.coordinates as number[][][] }
            : { type: 'MultiPolygon', coordinates: geometry.coordinates as number[][][][] },
        properties: { parcelId: properties.parcelId, selected: properties.parcelId === selectedId },
      })),
    };
    source.setData(data);

    const bounds = new mapboxgl.LngLatBounds();
    const previousFocus = focusedParcel.current;
    focusedParcel.current = '';
    const markers = visible.flatMap((parcel) => {
      const extent = parcelBounds(parcel);
      if (extent.isEmpty()) return [];
      const { parcelId, situs } = parcel.properties;
      const active = parcelId === selectedId;
      if (parcels.includes(parcel)) bounds.extend(extent);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pbk-street-parcel';
      button.dataset.parcelId = parcelId;
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', 'Parcel ' + parcelId + ', ' + situs.line1);
      button.setAttribute('aria-pressed', String(active));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (selection.current.busy) return;
        selection.current.onSelect(parcelId);
      });
      const marker = new mapboxgl.Marker({ element: button })
        .setLngLat(extent.getCenter())
        .addTo(field);
      if (previousFocus === parcelId) button.focus({ preventScroll: true });
      return [marker];
    });
    if (
      !bounds.isEmpty() &&
      (!fittedParcels.current || (fitParcels && fittedParcels.current !== parcels))
    ) {
      field.fitBounds(bounds, { padding: 32, maxZoom: 17, duration: 0 });
      fittedParcels.current = parcels;
    }
    if (selected) {
      const extent = parcelBounds(selected);
      if (!extent.isEmpty() && !field.getBounds().contains(extent.getCenter())) {
        field.fitBounds(extent, { padding: 40, maxZoom: 17, duration: 0 });
      }
    }
    return () => {
      markers.forEach((marker) => {
        const button = marker.getElement();
        if (document.activeElement === button)
          focusedParcel.current = button.dataset.parcelId ?? '';
        marker.remove();
      });
    };
  }, [parcels, selected, ready, fitParcels]);

  return (
    <>
      <div
        ref={container}
        className="pbk-dialer-street-map"
        role="group"
        aria-label="Mapbox streets and interactive parcel boundaries"
        aria-busy={!ready}
      />
      {onLoadArea && (
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-dialer-map-area"
          disabled={busy || !areaReady || !ready}
          onClick={() => {
            const bounds = instance.current?.getBounds();
            if (bounds)
              onLoadArea([
                Math.max(-180, bounds.getWest()),
                bounds.getSouth(),
                Math.min(180, bounds.getEast()),
                bounds.getNorth(),
              ]);
          }}
        >
          {areaReady ? 'Load parcels here' : 'Zoom in to load parcels'}
        </button>
      )}
    </>
  );
}
