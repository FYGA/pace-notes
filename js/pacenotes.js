const DEFAULT_AND_GAP_METERS = 50;

const NUMERICAL_PROFILE = createBuiltInProfile({
  id: "numerical",
  severities: {
    1: "1",
    2: "2",
    3: "3",
    4: "4",
    5: "5",
    6: "6",
  },
});

const DESCRIPTIVE_PROFILE = createBuiltInProfile({
  id: "descriptive",
  severities: {
    1: "very tight",
    2: "tight",
    3: "medium",
    4: "open",
    5: "very open",
    6: "gentle",
  },
});

export const PACENOTE_PROFILES = Object.freeze({
  numerical: NUMERICAL_PROFILE,
  descriptive: DESCRIPTIVE_PROFILE,
});

/**
 * Render one semantic corner. Geometry code may populate the corner fields,
 * but all language choices live here.
 *
 * Supported semantic fields include:
 * - direction: "L"/"R" or "left"/"right"
 * - severity: 1..6
 * - shape: "square"/"hairpin" (legacy isSquare/isHairpin also work)
 * - adjustment: "+"/"-" (gradeAdjustment/plusMinus also work)
 * - modifiers: ordered strings or { type, toSeverity, adjustment } objects
 * - manualAnnotations: ordered strings or { text } objects
 *
 * Generic annotations are rendered only when explicitly marked manual.
 */
export function renderCornerCall(corner, profile = "numerical") {
  if (!corner || typeof corner !== "object") {
    throw new TypeError("A corner is required to render a pacenote.");
  }

  const resolvedProfile = resolvePacenoteProfile(profile);
  const direction = renderDirection(corner.direction, resolvedProfile);
  const shape = normalizeShape(corner);
  const base = shape
    ? renderShape(shape, resolvedProfile)
    : renderGrade(
        corner.severity,
        cornerAdjustment(corner),
        corner,
        resolvedProfile,
      );
  const modifiers = renderModifiers(corner, resolvedProfile);
  const call = [direction, base, ...modifiers].filter(Boolean).join(" ");
  const annotations = manualAnnotations(corner);

  return annotations.length ? `${call}, ${annotations.join(", ")}` : call;
}

/**
 * Render a linked pair as one atomic phrase.
 *
 * `connection` may be supplied directly or as current.connectionToNext / 
 * next.connectionFromPrevious. `kind: "no-straight"` is the only semantic
 * value that produces "into"; a small numeric gap alone remains "and".
 */
export function renderLinkedCall(
  current,
  next,
  profile = "numerical",
  connection = null,
) {
  if (!next || typeof next !== "object") {
    return renderCornerCall(current, profile);
  }

  const connector = renderConnector(
    connection ?? current?.connectionToNext ?? next.connectionFromPrevious,
    current,
    next,
  );
  return `${renderCornerCall(current, profile)}, ${connector}, ${renderCornerCall(next, profile)}`;
}

/**
 * Resolve a built-in profile name or merge a custom profile over a built-in.
 * A custom `formatGrade` hook receives
 * `{ severity, label, adjustment, corner, profile }`.
 */
export function resolvePacenoteProfile(profile = "numerical") {
  if (typeof profile === "string") {
    const normalizedName = profile === "numeric" ? "numerical" : profile;
    const builtIn = PACENOTE_PROFILES[normalizedName];
    if (!builtIn) throw new RangeError(`Unknown pacenote profile: ${profile}`);
    return builtIn;
  }

  if (!profile || typeof profile !== "object") {
    throw new TypeError("A pacenote profile must be a profile name or object.");
  }

  const base = resolvePacenoteProfile(profile.base || "numerical");
  return Object.freeze({
    ...base,
    ...profile,
    directions: Object.freeze({ ...base.directions, ...profile.directions }),
    shapes: Object.freeze({ ...base.shapes, ...profile.shapes }),
    severities: Object.freeze({ ...base.severities, ...profile.severities }),
    modifiers: Object.freeze({ ...base.modifiers, ...profile.modifiers }),
    formatGrade: profile.formatGrade || base.formatGrade,
  });
}

function createBuiltInProfile({ id, severities }) {
  return Object.freeze({
    id,
    directions: Object.freeze({ L: "left", R: "right" }),
    shapes: Object.freeze({ hairpin: "hairpin", square: "square" }),
    severities: Object.freeze({ ...severities }),
    modifiers: Object.freeze({ tightens: "tightens", opens: "opens" }),
    formatGrade: defaultGradeFormatter,
  });
}

function defaultGradeFormatter({ label, adjustment }) {
  return adjustment ? `${label}${adjustment}` : label;
}

function renderDirection(direction, profile) {
  const normalized = String(direction || "").trim().toUpperCase();
  const key = normalized === "LEFT" ? "L" : normalized === "RIGHT" ? "R" : normalized;
  const rendered = profile.directions[key];
  if (!rendered) throw new RangeError(`Unsupported corner direction: ${direction}`);
  return rendered;
}

function normalizeShape(corner) {
  if (corner.isHairpin) return "hairpin";
  if (corner.isSquare) return "square";
  const shape = String(corner.shape || "").trim().toLowerCase();
  return shape && shape !== "normal" ? shape : null;
}

function renderShape(shape, profile) {
  const rendered = profile.shapes[shape];
  if (!rendered) throw new RangeError(`Unsupported corner shape: ${shape}`);
  return rendered;
}

function renderGrade(severity, adjustment, corner, profile) {
  const normalizedSeverity = Number(severity);
  const label = profile.severities[normalizedSeverity];
  if (!label || !Number.isInteger(normalizedSeverity)) {
    throw new RangeError(`Unsupported corner severity: ${severity}`);
  }

  return String(
    profile.formatGrade({
      severity: normalizedSeverity,
      label,
      adjustment,
      corner,
      profile,
    }),
  ).trim();
}

function renderModifiers(corner, profile) {
  const modifiers = Array.isArray(corner.modifiers)
    ? corner.modifiers
    : corner.modifier
      ? [legacyModifier(corner)]
      : [];

  return modifiers.map((modifier) => renderModifier(modifier, corner, profile));
}

function legacyModifier(corner) {
  return {
    type: corner.modifier,
    toSeverity: corner.modifierSeverity,
    adjustment: corner.modifierAdjustment,
  };
}

function renderModifier(modifier, corner, profile) {
  const semanticModifier =
    typeof modifier === "string"
      ? {
          type: modifier,
          toSeverity:
            modifier === corner.modifier ? corner.modifierSeverity : undefined,
        }
      : modifier;
  if (!semanticModifier || typeof semanticModifier !== "object") {
    throw new TypeError("Corner modifiers must be strings or semantic modifier objects.");
  }

  const type = String(semanticModifier.type || "").trim().toLowerCase();
  if (!type) throw new RangeError("A corner modifier type is required.");
  const label = profile.modifiers[type] || type.replaceAll("-", " ");
  const targetSeverity =
    semanticModifier.toSeverity ??
    semanticModifier.severity ??
    semanticModifier.modifierSeverity;

  if (targetSeverity === undefined || targetSeverity === null) return label;
  const adjustment = normalizeAdjustment(
    semanticModifier.adjustment ?? semanticModifier.gradeAdjustment,
  );
  return `${label} ${renderGrade(targetSeverity, adjustment, corner, profile)}`;
}

function cornerAdjustment(corner) {
  return normalizeAdjustment(
    corner.adjustment ?? corner.gradeAdjustment ?? corner.plusMinus,
  );
}

function normalizeAdjustment(adjustment) {
  if (adjustment === undefined || adjustment === null || adjustment === "") return null;
  const normalized = String(adjustment).trim().toLowerCase();
  if (normalized === "+" || normalized === "plus") return "+";
  if (normalized === "-" || normalized === "minus") return "-";
  throw new RangeError(`Unsupported grade adjustment: ${adjustment}`);
}

function manualAnnotations(corner) {
  const annotations = [];
  const explicitlyManual = Array.isArray(corner.manualAnnotations)
    ? corner.manualAnnotations
    : [];
  const markedManual = Array.isArray(corner.annotations)
    ? corner.annotations.filter(
        (annotation) =>
          annotation &&
          typeof annotation === "object" &&
          (annotation.source === "manual" || annotation.manual === true),
      )
    : [];

  for (const annotation of [...explicitlyManual, ...markedManual]) {
    const text =
      typeof annotation === "string" ? annotation.trim() : String(annotation.text || "").trim();
    if (text && !annotations.includes(text)) annotations.push(text);
  }

  if (
    corner.caution &&
    (corner.cautionSource === "manual" || corner.cautionManual === true)
  ) {
    const caution = String(corner.caution).trim();
    if (caution && !annotations.includes(caution)) annotations.push(caution);
  }
  return annotations;
}

function renderConnector(connection, current, next) {
  if (connection !== null && connection !== undefined) {
    if (typeof connection !== "object") {
      throw new TypeError("A semantic connection must be an object.");
    }
    const kind = String(connection.kind || connection.type || "").trim().toLowerCase();
    if (kind === "no-straight") return "into";
    if (kind === "and") return "and";
    if (kind === "distance") {
      return roundedDistance(
        connection.meters ?? connection.distanceMeters ?? cornerGap(current, next),
      );
    }
    if (kind === "into") {
      throw new RangeError('Use the explicit semantic connector kind "no-straight" for into.');
    }
    throw new RangeError(`Unsupported semantic connector: ${kind || "missing kind"}`);
  }

  const gap = cornerGap(current, next);
  return Number.isFinite(gap) && gap > DEFAULT_AND_GAP_METERS
    ? roundedDistance(gap)
    : "and";
}

function cornerGap(current, next) {
  const currentDistance =
    current?.exitDistanceMeters ?? current?.endDistance ?? cornerDistance(current);
  const nextDistance = cornerDistance(next);
  return nextDistance - currentDistance;
}

function cornerDistance(corner) {
  if (Number.isFinite(corner?.entryDistanceMeters)) {
    return corner.entryDistanceMeters;
  }
  if (Number.isFinite(corner?.distanceFromStart)) return corner.distanceFromStart;
  if (Number.isFinite(corner?.distance)) return corner.distance;
  return Number.NaN;
}

function roundedDistance(meters) {
  const numericMeters = Number(meters);
  if (!Number.isFinite(numericMeters) || numericMeters <= 0) {
    throw new RangeError(`A positive connector distance is required: ${meters}`);
  }
  return String(Math.max(10, Math.round(numericMeters / 10) * 10));
}
