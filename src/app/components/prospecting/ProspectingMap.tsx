import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxStreetStyle } from '../../utils/mapboxConfig';
import 'mapbox-gl/mapbox-gl.css';

type MapParcel = {
  parcelId: string;
  line1: string;
  longitude?: number;
  latitude?: number;
};

type Props = {
  token: string;
  parcels: MapParcel[];
  selectedId: string | null;
  onSelect: (parcelId: string) => void;
};

export default function ProspectingMap({ token, parcels, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const buttons = markers.current;
    const bounds = new mapboxgl.LngLatBounds();
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: element,
        accessToken: token,
        style: mapboxStreetStyle,
        center: [-118.448, 34.19],
        zoom: 12,
        dragRotate: false,
        pitchWithRotate: false,
        scrollZoom: false,
        cooperativeGestures: true,
        renderWorldCopies: false,
        performanceMetricsCollection: false,
      });
    } catch {
      setStatus('unavailable');
      return;
    }

    const parcelMarkers: mapboxgl.Marker[] = [];
    let active = true;
    const timeout = window.setTimeout(unavailable, 15_000);

    function dispose() {
      if (!active) return;
      active = false;
      window.clearTimeout(timeout);
      parcelMarkers.forEach((marker) => marker.remove());
      buttons.clear();
      map.remove();
    }

    function unavailable() {
      if (!active) return;
      dispose();
      setStatus('unavailable');
    }

    map.once('load', () => {
      window.clearTimeout(timeout);
      setStatus('ready');
    });
    map.on('error', ({ error }) => {
      if ('status' in error && (error.status === 401 || error.status === 403)) {
        queueMicrotask(unavailable);
      }
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();
    parcels.forEach(({ parcelId, line1, longitude, latitude }, index) => {
      if (
        longitude == null ||
        latitude == null ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 ||
        Math.abs(latitude) > 85
      )
        return;

      const coordinates: [number, number] = [longitude, latitude];
      const button = document.createElement('button');
      button.type = 'button';
      // Mapbox defaults custom markers without an explicit role to images.
      button.setAttribute('role', 'button');
      button.className = 'pbk-prospecting-map-pin';
      button.textContent = String(index + 1);
      button.setAttribute('aria-label', 'Parcel ' + (index + 1) + ', ' + line1);
      button.setAttribute('aria-controls', 'prospecting-parcel-' + parcelId);
      button.addEventListener('click', () => onSelect(parcelId));
      parcelMarkers.push(
        new mapboxgl.Marker({ element: button }).setLngLat(coordinates).addTo(map)
      );
      buttons.set(parcelId, button);
      bounds.extend(coordinates);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 46, maxZoom: 16, duration: 0 });
    }

    return dispose;
  }, [token, parcels, onSelect]);

  useEffect(() => {
    markers.current.forEach((button, parcelId) => {
      if (parcelId === selectedId) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }, [parcels, selectedId]);

  return (
    <div className="pbk-prospecting-map">
      <div className="pbk-prospecting-map-heading">
        <h3>Parcel map</h3>
        {status !== 'unavailable' && <p>Numbered pins show county-recorded parcel centers.</p>}
      </div>
      {status !== 'unavailable' && (
        <div className="pbk-prospecting-map-frame">
          <div
            ref={container}
            className="pbk-prospecting-map-canvas"
            role="region"
            aria-label="Van Nuys parcel map"
            aria-busy={status === 'loading'}
            inert={status === 'loading'}
          />
          {status === 'loading' && <p role="status">Loading parcel map…</p>}
        </div>
      )}
      {status === 'unavailable' && (
        <p role="status">The map couldn’t load. You can review every parcel below.</p>
      )}
    </div>
  );
}
