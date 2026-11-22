const configuredToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN?.trim();

export const mapboxPublicToken = configuredToken?.startsWith('pk.') ? configuredToken : undefined;
export const mapboxStreetStyle = 'mapbox://styles/mapbox/light-v11';
