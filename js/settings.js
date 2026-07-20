const TOKEN_STORAGE_KEY = 'paceNotes.mapboxToken';
const LEGACY_TOKEN_STORAGE_KEY = 'mapboxToken';

export function loadMapboxToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
    || localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY)
    || '';
}

export function saveMapboxToken(token) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
}

export function maskToken(token) {
  if (!token) return '';
  if (token.length <= 10) return '••••••••••';
  return `${token.slice(0, 5)}••••••••${token.slice(-5)}`;
}
