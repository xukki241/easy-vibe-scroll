/**
 * Shared defaults & profile presets for Smooth Scroll Free.
 * Values mirror the public options UX (Chrome Web Store screenshots).
 */

export const DEFAULTS = Object.freeze({
  profile: "default",
  stepSize: 120,
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
    stepSize: 120,
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

export function normalizeSettings(raw = {}) {
  const merged = { ...DEFAULTS, ...raw };
  // Keep accelerationScale / accelerationMax in sync (UI uses "Acceleration scale")
  if (raw.accelerationScale != null && raw.accelerationMax == null) {
    merged.accelerationMax = Number(raw.accelerationScale);
  }
  merged.accelerationScale = Number(merged.accelerationMax);
  merged.stepSize = Number(merged.stepSize);
  merged.animationTime = Number(merged.animationTime);
  merged.accelerationDelta = Number(merged.accelerationDelta);
  merged.pulseScale = Number(merged.pulseScale);
  merged.arrowScroll = Number(merged.arrowScroll);
  merged.frameRate = Number(merged.frameRate) || DEFAULTS.frameRate;
  merged.keyboardSupport = Boolean(merged.keyboardSupport);
  merged.touchpadSupport = Boolean(merged.touchpadSupport);
  merged.pulseAlgorithm = Boolean(merged.pulseAlgorithm);
  merged.middleMouse = Boolean(merged.middleMouse);
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
