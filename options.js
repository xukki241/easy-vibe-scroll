import {
  DEFAULTS,
  PROFILE_ORDER,
  applyProfile,
  normalizeSettings,
} from "./src/defaults.js";

const NUMBER_FIELDS = [
  "stepSize",
  "animationTime",
  "accelerationScale",
  "accelerationDelta",
  "pulseScale",
  "arrowScroll",
];

const BOOL_FIELDS = [
  "keyboardSupport",
  "touchpadSupport",
  "pulseAlgorithm",
  "middleMouse",
];

const statusEl = document.getElementById("status");
let saveTimer = null;
let current = normalizeSettings(DEFAULTS);
/** Field id currently being typed — never rewrite its .value mid-edit */
let editingNumberId = null;

function showStatus(msg) {
  statusEl.textContent = msg;
  if (msg) {
    setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = "";
    }, 1400);
  }
}

function parseNumberInput(raw) {
  const text = String(raw ?? "").trim();
  if (text === "" || text === "-" || text === "." || text === "-.") {
    return { ok: false, empty: true };
  }
  // Allow intermediate typing like "8." only as incomplete — don't commit yet
  if (!/^-?\d+(\.\d*)?$/.test(text) && !/^-?\d*\.\d+$/.test(text)) {
    return { ok: false, empty: false };
  }
  if (text.endsWith(".")) {
    return { ok: false, empty: false };
  }
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, empty: false };
  return { ok: true, value: n };
}

/**
 * Read the form. Incomplete/empty number fields keep the previous `current`
 * value so normalize/clamp never invents a digit while the user is typing.
 */
function readForm({ commitNumbers = false } = {}) {
  const next = { ...current };
  for (const id of NUMBER_FIELDS) {
    const el = document.getElementById(id);
    const parsed = parseNumberInput(el.value);
    if (parsed.ok) {
      next[id] = parsed.value;
    } else if (commitNumbers) {
      // blur/change with empty or garbage → fall back to last good / default
      next[id] = current[id];
    }
    // else: leave next[id] as current[id] (do not Number("") → 0 → clamp)
  }
  for (const id of BOOL_FIELDS) {
    next[id] = document.getElementById(id).checked;
  }
  next.accelerationMax = next.accelerationScale;
  return normalizeSettings(next);
}

function writeForm(settings, { skipEditing = true } = {}) {
  current = normalizeSettings(settings);
  for (const id of NUMBER_FIELDS) {
    if (skipEditing && editingNumberId === id) continue;
    const el = document.getElementById(id);
    // Avoid clobbering caret / typed text when value already matches
    if (String(el.value) === String(current[id])) continue;
    el.value = current[id];
  }
  for (const id of BOOL_FIELDS) {
    document.getElementById(id).checked = Boolean(current[id]);
  }
  document.querySelectorAll(".profile").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.profile === current.profile);
  });
}

function persist(settings, { silent } = {}) {
  const payload = normalizeSettings(settings);
  payload.accelerationMax = payload.accelerationScale;
  chrome.storage.sync.set(payload, () => {
    current = payload;
    if (!silent) showStatus("Saved");
  });
}

function markCustomIfChanged(next) {
  if (next.profile === "custom") return next;
  const baseline = applyProfile(next.profile, next);
  const changed = NUMBER_FIELDS.some(
    (k) => Number(next[k]) !== Number(baseline[k])
  );
  if (changed) next.profile = "custom";
  return next;
}

/** Debounced save while typing — updates storage/current but does NOT rewrite inputs */
function scheduleSaveFromTyping() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const el = editingNumberId && document.getElementById(editingNumberId);
    if (el) {
      const parsed = parseNumberInput(el.value);
      if (!parsed.ok) return; // still empty / incomplete — wait
    }
    let next = readForm({ commitNumbers: false });
    next = markCustomIfChanged(next);
    // Update profile highlight + in-memory current without rewriting the active field
    writeForm(next, { skipEditing: true });
    persist(next, { silent: true });
  }, 400);
}

/** Commit + clamp + rewrite on blur/change when editing finished */
function commitNumberField(id) {
  clearTimeout(saveTimer);
  editingNumberId = null;
  const el = document.getElementById(id);
  const parsed = parseNumberInput(el.value);
  let next = { ...current };
  if (parsed.ok) {
    next[id] = parsed.value;
  } else {
    // Empty or invalid on blur → restore last good clamped value
    next[id] = current[id];
  }
  next.accelerationMax =
    id === "accelerationScale" ? next[id] : next.accelerationScale;
  for (const bid of BOOL_FIELDS) {
    next[bid] = document.getElementById(bid).checked;
  }
  next = markCustomIfChanged(normalizeSettings(next));
  writeForm(next, { skipEditing: false });
  persist(next);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    writeForm(normalizeSettings(stored), { skipEditing: false });
  });
}

document.querySelectorAll(".profile").forEach((btn) => {
  btn.addEventListener("click", () => {
    clearTimeout(saveTimer);
    editingNumberId = null;
    const key = btn.dataset.profile;
    if (key === "custom") {
      const next = normalizeSettings({
        ...readForm({ commitNumbers: true }),
        profile: "custom",
      });
      writeForm(next, { skipEditing: false });
      persist(next);
      return;
    }
    const next = applyProfile(key, readForm({ commitNumbers: true }));
    writeForm(next, { skipEditing: false });
    persist(next);
    showStatus(`Loaded ${btn.textContent} profile`);
  });
});

NUMBER_FIELDS.forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("focus", () => {
    editingNumberId = id;
  });
  el.addEventListener("input", () => {
    editingNumberId = id;
    scheduleSaveFromTyping();
  });
  el.addEventListener("change", () => commitNumberField(id));
  el.addEventListener("blur", () => commitNumberField(id));
});

BOOL_FIELDS.forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    const next = readForm({ commitNumbers: true });
    writeForm(next, { skipEditing: false });
    persist(next);
  });
});

document.getElementById("resetBtn").addEventListener("click", () => {
  clearTimeout(saveTimer);
  editingNumberId = null;
  const next = applyProfile("default", DEFAULTS);
  writeForm(next, { skipEditing: false });
  persist(next);
  showStatus("Reset to Default");
});

// Ensure profile buttons stay ordered as in the screenshot
PROFILE_ORDER.forEach((key, index) => {
  const btn = document.querySelector(`.profile[data-profile="${key}"]`);
  if (btn) btn.style.order = String(index);
});

load();
