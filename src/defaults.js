/**
 * Shared defaults & profile presets for Smooth Scroll Free.
 * Values mirror the public options UX (Chrome/Edge Web Store screenshots).
 */

export const DEFAULTS = Object.freeze({
  profile: "default",
  stepSize: 100,
  animationTime: 400,
  accelerationMax: 3,
  accelerationDelta: 50,
  pulseScale: 4,
  arrowScroll: 50,
  keyboardSupport: true,
  touchpadSupport: false,
  pulseAlgorithm: true,
  middleMouse: true,
  frameRate: 150,
  accelerationScale: 3, // alias used in UI label
});

/** Named profiles — approximate classic browser scroll feels. */
export const PROFILES = Object.freeze({
  custom: null, // means "keep current numbers"
  default: {
    stepSize: 100,
    animationTime: 400,
    accelerationMax: 3,
    accelerationDelta: 50,
    pulseScale: 4,
    arrowScroll: 50,
  },
  iphone: {
    stepSize: 40,
    animationTime: 280,
    accelerationMax: 2,
    accelerationDelta: 40,
    pulseScale: 3,
    arrowScroll: 40,
  },
  opera: {
    stepSize: 80,
    animationTime: 360,
    accelerationMax: 2.5,
    accelerationDelta: 45,
    pulseScale: 3.5,
    arrowScroll: 45,
  },
  ie: {
    stepSize: 100,
    animationTime: 280,
    accelerationMax: 1.5,
    accelerationDelta: 60,
    pulseScale: 2.5,
    arrowScroll: 50,
  },
});

export const PROFILE_ORDER = ["custom", "default", "iphone", "opera", "ie"];

export const PROFILE_LABELS = {
  custom: "Custom",
  default: "Default",
  iphone: "iPhone",
  opera: "Opera",
  ie: "IE",
};

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function normalizeSettings(raw = {}) {
  const merged = { ...DEFAULTS, ...raw };
  // Keep accelerationScale / accelerationMax in sync (UI uses "Acceleration scale")
  if (raw.accelerationScale != null && raw.accelerationMax == null) {
    merged.accelerationMax = Number(raw.accelerationScale);
  }
  merged.accelerationMax = clamp(
    merged.accelerationMax,
    1,
    10,
    DEFAULTS.accelerationMax
  );
  merged.accelerationScale = merged.accelerationMax;
  merged.stepSize = clamp(merged.stepSize, 1, 1000, DEFAULTS.stepSize);
  merged.animationTime = clamp(
    merged.animationTime,
    50,
    2000,
    DEFAULTS.animationTime
  );
  merged.accelerationDelta = clamp(
    merged.accelerationDelta,
    1,
    500,
    DEFAULTS.accelerationDelta
  );
  merged.pulseScale = clamp(merged.pulseScale, 0.5, 20, DEFAULTS.pulseScale);
  merged.arrowScroll = clamp(merged.arrowScroll, 1, 500, DEFAULTS.arrowScroll);
  merged.frameRate = clamp(merged.frameRate, 30, 240, DEFAULTS.frameRate);
  merged.keyboardSupport = Boolean(merged.keyboardSupport);
  merged.touchpadSupport = Boolean(merged.touchpadSupport);
  merged.pulseAlgorithm = Boolean(merged.pulseAlgorithm);
  merged.middleMouse = Boolean(merged.middleMouse);
  // Only allow known profile keys
  const profile = String(merged.profile || "default").toLowerCase();
  merged.profile = PROFILE_ORDER.includes(profile) ? profile : "custom";
  return merged;
}

export function applyProfile(profileKey, current) {
  const key = String(profileKey || "default").toLowerCase();
  if (key === "custom" || !PROFILES[key]) {
    return normalizeSettings({ ...current, profile: "custom" });
  }
  return normalizeSettings({
    ...current,
    ...PROFILES[key],
    profile: key,
  });
}
