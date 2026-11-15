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

function showStatus(msg) {
  statusEl.textContent = msg;
  if (msg) {
    setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = "";
    }, 1400);
  }
}

function readForm() {
  const next = { ...current };
  for (const id of NUMBER_FIELDS) {
    const el = document.getElementById(id);
    next[id] = Number(el.value);
  }
  for (const id of BOOL_FIELDS) {
    next[id] = document.getElementById(id).checked;
  }
  next.accelerationMax = next.accelerationScale;
  return normalizeSettings(next);
}

function writeForm(settings) {
  current = normalizeSettings(settings);
  for (const id of NUMBER_FIELDS) {
    document.getElementById(id).value = current[id];
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

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const next = readForm();
    // Any manual edit → Custom profile
    if (next.profile !== "custom") {
      const baseline = applyProfile(next.profile, next);
      const changed = NUMBER_FIELDS.some(
        (k) => Number(next[k]) !== Number(baseline[k])
      );
      if (changed) next.profile = "custom";
    }
    writeForm(next);
    persist(next);
  }, 200);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    writeForm(normalizeSettings(stored));
  });
}

document.querySelectorAll(".profile").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.profile;
    if (key === "custom") {
      const next = normalizeSettings({ ...readForm(), profile: "custom" });
      writeForm(next);
      persist(next);
      return;
    }
    const next = applyProfile(key, readForm());
    writeForm(next);
    persist(next);
    showStatus(`Loaded ${btn.textContent} profile`);
  });
});

NUMBER_FIELDS.forEach((id) => {
  document.getElementById(id).addEventListener("input", scheduleSave);
  document.getElementById(id).addEventListener("change", scheduleSave);
});

BOOL_FIELDS.forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    const next = readForm();
    writeForm(next);
    persist(next);
  });
});

document.getElementById("resetBtn").addEventListener("click", () => {
  const next = applyProfile("default", DEFAULTS);
  writeForm(next);
  persist(next);
  showStatus("Reset to Default");
});

// Ensure profile buttons stay ordered as in the screenshot
PROFILE_ORDER.forEach((key, index) => {
  const btn = document.querySelector(`.profile[data-profile="${key}"]`);
  if (btn) btn.style.order = String(index);
});

load();
