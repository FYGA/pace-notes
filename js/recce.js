import { renderCornerCall, renderLinkedCall } from "./pacenotes.js";

export const RECCE_REVIEW_SCHEMA_VERSION = 1;
export const RECCE_REVIEW_KIND = "pace-note-recce-overrides";
export const MANUAL_RECCE_SOURCE = "manual-recce";

const REVIEW_STATUS = "reviewed";
const EDITABLE_FIELDS = new Set([
  "direction",
  "severity",
  "shape",
  "adjustment",
  "modifiers",
  "manualAnnotations",
  "caution",
]);
const SHAPES = new Set(["normal", "square", "hairpin"]);
const MODIFIER_TYPES = new Set(["long", "tightens", "opens", "late"]);
const MAX_NOTE_ID_LENGTH = 256;
const MAX_REVIEWER_LENGTH = 100;
const MAX_ANNOTATIONS = 8;
const MAX_ANNOTATION_LENGTH = 80;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Create a serializable, immutable-by-convention review layer.
 *
 * Review records are stored by stable generated note id. Geometry, route
 * indices, and distances never live in this layer, so a profile
 * rematerialization can safely reapply the same review records.
 */
export function createRecceReviewLayer() {
  return {
    schemaVersion: RECCE_REVIEW_SCHEMA_VERSION,
    kind: RECCE_REVIEW_KIND,
    overrides: {},
  };
}

/** Validate a persisted review layer. Returns true or throws. */
export function validateRecceReviewLayer(layer) {
  if (!isPlainObject(layer)) {
    throw new TypeError("A recce review layer must be an object.");
  }
  if (layer.schemaVersion !== RECCE_REVIEW_SCHEMA_VERSION) {
    throw new RangeError(
      `Unsupported recce review schema version: ${layer.schemaVersion}`,
    );
  }
  if (layer.kind !== RECCE_REVIEW_KIND) {
    throw new TypeError(`A recce review layer must have kind ${RECCE_REVIEW_KIND}.`);
  }
  if (!isPlainObject(layer.overrides)) {
    throw new TypeError("Recce overrides must be keyed by note id.");
  }

  for (const [key, record] of Object.entries(layer.overrides)) {
    const noteId = normalizeNoteId(key);
    if (!isPlainObject(record)) {
      throw new TypeError(`The recce review for ${noteId} must be an object.`);
    }
    if (record.noteId !== noteId) {
      throw new TypeError(`The recce review key and noteId must match for ${noteId}.`);
    }
    if (record.source !== MANUAL_RECCE_SOURCE) {
      throw new TypeError(`The recce review for ${noteId} needs manual provenance.`);
    }
    if (record.status !== REVIEW_STATUS) {
      throw new RangeError(`Unsupported recce review status for ${noteId}.`);
    }
    normalizeReviewer(record.reviewer);
    normalizeReviewedAt(record.reviewedAt);
    normalizeChanges(record.changes);
  }
  return true;
}

/**
 * Add or replace one reviewed note record without mutating the prior layer.
 * Passing an empty changes object records a review with no semantic edits.
 */
export function setRecceOverride(
  layer,
  noteId,
  changes = {},
  { reviewer = null, reviewedAt = null } = {},
) {
  validateRecceReviewLayer(layer);
  const normalizedId = normalizeNoteId(noteId);
  const record = {
    noteId: normalizedId,
    source: MANUAL_RECCE_SOURCE,
    status: REVIEW_STATUS,
    reviewer: normalizeReviewer(reviewer),
    reviewedAt: normalizeReviewedAt(reviewedAt),
    changes: normalizeChanges(changes),
  };
  return {
    ...layer,
    overrides: {
      ...layer.overrides,
      [normalizedId]: record,
    },
  };
}

/** Mark a generated note reviewed without changing its call semantics. */
export function markRecceReviewed(layer, noteId, metadata = {}) {
  return setRecceOverride(layer, noteId, {}, metadata);
}

/** Remove a review/edit record, restoring generated behavior on next apply. */
export function revertRecceOverride(layer, noteId) {
  validateRecceReviewLayer(layer);
  const normalizedId = normalizeNoteId(noteId);
  if (!Object.hasOwn(layer.overrides, normalizedId)) return layer;
  const overrides = { ...layer.overrides };
  delete overrides[normalizedId];
  return { ...layer, overrides };
}

/** Return explicit reviewed/unreviewed state for one stable note id. */
export function recceStatusFor(layer, noteId) {
  validateRecceReviewLayer(layer);
  const normalizedId = normalizeNoteId(noteId);
  const record = layer.overrides[normalizedId];
  if (!record) {
    return { status: "unreviewed", edited: false, source: null };
  }
  return {
    status: REVIEW_STATUS,
    edited: Object.keys(record.changes).length > 0,
    source: MANUAL_RECCE_SOURCE,
    reviewer: record.reviewer,
    reviewedAt: record.reviewedAt,
  };
}

/**
 * Apply reviews to freshly materialized notes and render the current profile.
 * Input notes and the review layer are not mutated. Unknown/stale note ids in
 * the review layer are retained for future route rematerializations but do not
 * affect the supplied note list.
 */
export function applyRecceOverrides(notes, layer, { profileId = null } = {}) {
  validateRecceReviewLayer(layer);
  if (!Array.isArray(notes)) {
    throw new TypeError("Materialized pace notes must be an array.");
  }

  const seenIds = new Set();
  const applied = notes.map((note) => {
    if (!isPlainObject(note)) {
      throw new TypeError("Every materialized pace note must be an object.");
    }
    const noteId = normalizeNoteId(note.id);
    if (seenIds.has(noteId)) {
      throw new RangeError(`Duplicate materialized pace-note id: ${noteId}`);
    }
    seenIds.add(noteId);

    const review = layer.overrides[noteId];
    const activeProfile = profileId || note.profileId || "numerical";
    const next = review
      ? applyReviewRecord(note, review, activeProfile)
      : { ...note, profileId: activeProfile };
    return renderMaterializedNote(next, activeProfile);
  });

  return applied.map((note, index) => {
    const next = applied[index + 1];
    return {
      ...note,
      linkedCall: next
        ? renderLinkedCall(
            note,
            next,
            note.profileId,
            note.connectionToNext ?? null,
          )
        : note.call,
    };
  });
}

/**
 * Apply reviews to a route and synchronize its runtime remaining-note copies.
 * Runtime `distance` and `callState` values remain authoritative.
 */
export function applyRecceOverridesToRoute(
  route,
  layer,
  { profileId = route?.profileId || "numerical" } = {},
) {
  if (!isPlainObject(route) || !Array.isArray(route.curves)) {
    throw new TypeError("A materialized route with curves is required.");
  }
  const curves = applyRecceOverrides(route.curves, layer, { profileId });
  const curvesById = new Map(curves.map((curve) => [curve.id, curve]));
  const remainingCurves = Array.isArray(route.remainingCurves)
    ? route.remainingCurves.map((runtimeCurve) => {
        const reviewed = curvesById.get(runtimeCurve.id);
        if (!reviewed) return { ...runtimeCurve };
        return {
          ...reviewed,
          distance: runtimeCurve.distance,
          callState: runtimeCurve.callState,
        };
      })
    : curves.map((curve) => ({ ...curve }));

  return {
    ...route,
    profileId,
    curves,
    remainingCurves,
  };
}

function applyReviewRecord(note, review, profileId) {
  // Normalize again at the application boundary so a validated layer loaded
  // from JSON behaves like one produced by setRecceOverride, even if its
  // otherwise-valid values use aliases such as "right" or annotation strings.
  const changes = normalizeChanges(review.changes);
  const next = {
    ...note,
    ...semanticChanges(changes),
    profileId,
    verified: note.verified === true,
    reviewed: true,
    reviewStatus: REVIEW_STATUS,
    reviewSource: MANUAL_RECCE_SOURCE,
    manualReview: {
      source: MANUAL_RECCE_SOURCE,
      status: REVIEW_STATUS,
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      fields: Object.keys(changes),
      changes: cloneValue(changes),
    },
  };

  if (Object.hasOwn(changes, "manualAnnotations")) {
    next.manualAnnotations = changes.manualAnnotations.map((annotation) => ({
      text: annotation.text,
      source: "manual",
      manual: true,
    }));
  }
  if (Object.hasOwn(changes, "caution")) {
    if (changes.caution === null) {
      delete next.caution;
      delete next.cautionSource;
      delete next.cautionManual;
    } else {
      next.caution = changes.caution;
      next.cautionSource = "manual";
      next.cautionManual = true;
    }
  }
  return next;
}

function renderMaterializedNote(note, profileId) {
  const call = renderCornerCall(note, profileId);
  const shortLabel = renderCornerCall(
    {
      ...note,
      modifiers: [],
      manualAnnotations: [],
      annotations: [],
      caution: null,
      cautionSource: null,
      cautionManual: false,
    },
    profileId,
  )
    .replace(/^left /, "L ")
    .replace(/^right /, "R ");
  return { ...note, call, shortLabel };
}

function semanticChanges(changes) {
  const semantic = {};
  for (const field of [
    "direction",
    "severity",
    "shape",
    "adjustment",
    "modifiers",
  ]) {
    if (Object.hasOwn(changes, field)) semantic[field] = cloneValue(changes[field]);
  }
  if (Object.hasOwn(changes, "shape")) {
    semantic.isHairpin = changes.shape === "hairpin";
    semantic.isSquare = changes.shape === "square";
  }
  return semantic;
}

function normalizeChanges(changes) {
  if (!isPlainObject(changes)) {
    throw new TypeError("Recce changes must be an object.");
  }
  for (const field of Object.keys(changes)) {
    if (!EDITABLE_FIELDS.has(field)) {
      throw new RangeError(`Recce reviews cannot override ${field}.`);
    }
  }

  const normalized = {};
  if (Object.hasOwn(changes, "direction")) {
    const direction = String(changes.direction || "").trim().toUpperCase();
    const value = direction === "LEFT" ? "L" : direction === "RIGHT" ? "R" : direction;
    if (value !== "L" && value !== "R") {
      throw new RangeError("A manual direction must be L or R.");
    }
    normalized.direction = value;
  }
  if (Object.hasOwn(changes, "severity")) {
    const severity = Number(changes.severity);
    if (!Number.isInteger(severity) || severity < 1 || severity > 6) {
      throw new RangeError("A manual severity must be an integer from 1 to 6.");
    }
    normalized.severity = severity;
  }
  if (Object.hasOwn(changes, "shape")) {
    const shape = String(changes.shape || "").trim().toLowerCase();
    if (!SHAPES.has(shape)) {
      throw new RangeError("A manual shape must be normal, square, or hairpin.");
    }
    normalized.shape = shape;
  }
  if (Object.hasOwn(changes, "adjustment")) {
    normalized.adjustment = normalizeAdjustment(changes.adjustment);
  }
  if (Object.hasOwn(changes, "modifiers")) {
    normalized.modifiers = normalizeModifiers(changes.modifiers);
  }
  if (Object.hasOwn(changes, "manualAnnotations")) {
    normalized.manualAnnotations = normalizeAnnotations(changes.manualAnnotations);
  }
  if (Object.hasOwn(changes, "caution")) {
    normalized.caution =
      changes.caution === null ? null : normalizeAnnotationText(changes.caution);
  }
  return normalized;
}

function normalizeModifiers(modifiers) {
  if (!Array.isArray(modifiers)) {
    throw new TypeError("Manual modifiers must be an array.");
  }
  if (modifiers.length > 6) {
    throw new RangeError("A pace note can have at most six manual modifiers.");
  }
  const seen = new Set();
  return modifiers.map((modifier) => {
    const semantic = typeof modifier === "string" ? { type: modifier } : modifier;
    if (!isPlainObject(semantic)) {
      throw new TypeError("Every manual modifier must be a string or object.");
    }
    const allowedKeys = new Set(["type", "toSeverity", "adjustment"]);
    for (const key of Object.keys(semantic)) {
      if (!allowedKeys.has(key)) {
        throw new RangeError(`Unsupported manual modifier field: ${key}`);
      }
    }
    const type = String(semantic.type || "").trim().toLowerCase();
    if (!MODIFIER_TYPES.has(type)) {
      throw new RangeError(`Unsupported manual modifier: ${type || "empty"}`);
    }
    if (seen.has(type)) {
      throw new RangeError(`Duplicate manual modifier: ${type}`);
    }
    seen.add(type);
    const normalized = { type };
    if (semantic.toSeverity !== undefined && semantic.toSeverity !== null) {
      const target = Number(semantic.toSeverity);
      if (!Number.isInteger(target) || target < 1 || target > 6) {
        throw new RangeError("A modifier target severity must be an integer from 1 to 6.");
      }
      normalized.toSeverity = target;
    }
    if (semantic.adjustment !== undefined && semantic.adjustment !== null) {
      normalized.adjustment = normalizeAdjustment(semantic.adjustment);
    }
    return normalized;
  });
}

function normalizeAnnotations(annotations) {
  if (!Array.isArray(annotations)) {
    throw new TypeError("Manual annotations must be an array.");
  }
  if (annotations.length > MAX_ANNOTATIONS) {
    throw new RangeError(`A pace note can have at most ${MAX_ANNOTATIONS} annotations.`);
  }
  const seen = new Set();
  return annotations.map((annotation) => {
    const text = normalizeAnnotationText(
      typeof annotation === "string" ? annotation : annotation?.text,
    );
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) throw new RangeError(`Duplicate manual annotation: ${text}`);
    seen.add(key);
    return { text, source: "manual", manual: true };
  });
}

function normalizeAnnotationText(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > MAX_ANNOTATION_LENGTH || CONTROL_CHARACTERS.test(text)) {
    throw new RangeError(
      `Manual annotation text must be 1–${MAX_ANNOTATION_LENGTH} printable characters.`,
    );
  }
  return text;
}

function normalizeAdjustment(value) {
  if (value === null || value === "") return null;
  const adjustment = String(value).trim().toLowerCase();
  if (adjustment === "+" || adjustment === "plus") return "+";
  if (adjustment === "-" || adjustment === "minus") return "-";
  throw new RangeError("A manual adjustment must be +, -, plus, minus, or null.");
}

function normalizeNoteId(noteId) {
  const value = String(noteId ?? "").trim();
  if (
    !value ||
    value.length > MAX_NOTE_ID_LENGTH ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new RangeError("A stable pace-note id is required for recce review.");
  }
  return value;
}

function normalizeReviewer(reviewer) {
  if (reviewer === null || reviewer === undefined || reviewer === "") return null;
  const value = String(reviewer).trim();
  if (!value || value.length > MAX_REVIEWER_LENGTH || CONTROL_CHARACTERS.test(value)) {
    throw new RangeError(`A reviewer name must be at most ${MAX_REVIEWER_LENGTH} printable characters.`);
  }
  return value;
}

function normalizeReviewedAt(reviewedAt) {
  if (reviewedAt === null || reviewedAt === undefined || reviewedAt === "") return null;
  if (typeof reviewedAt !== "string" || !Number.isFinite(Date.parse(reviewedAt))) {
    throw new RangeError("reviewedAt must be an ISO-compatible timestamp or null.");
  }
  return new Date(reviewedAt).toISOString();
}

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null),
  );
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    );
  }
  return value;
}
