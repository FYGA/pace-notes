const TOKEN_STORAGE_KEY = 'paceNotes.mapboxToken';
const LEGACY_TOKEN_STORAGE_KEY = 'mapboxToken';
const PREFERENCES_STORAGE_KEY = 'paceNotes.preferences.v1';

export const DEFAULT_PACE_NOTE_PROFILE = 'numerical';
export const PACE_NOTE_PROFILE_IDS = Object.freeze([
  DEFAULT_PACE_NOTE_PROFILE,
  'descriptive',
]);

export function loadMapboxToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
      || localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY)
      || '';
  } catch {
    return '';
  }
}

export function saveMapboxToken(token) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function maskToken(token) {
  if (!token) return '';
  if (token.length <= 10) return '••••••••••';
  return `${token.slice(0, 5)}••••••••${token.slice(-5)}`;
}

export function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || '{}');
    return normalizePreferences(saved);
  } catch {
    return normalizePreferences();
  }
}

export function savePreferences(preferences) {
  const normalized = normalizePreferences(preferences);
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
  return normalized;
}

function normalizePreferences(preferences = {}) {
  const paceNoteProfile = PACE_NOTE_PROFILE_IDS.includes(
    preferences?.paceNoteProfile,
  )
    ? preferences.paceNoteProfile
    : DEFAULT_PACE_NOTE_PROFILE;
  return {
    paceNoteProfile,
    preferWindingRoutes: preferences?.preferWindingRoutes !== false,
  };
}
