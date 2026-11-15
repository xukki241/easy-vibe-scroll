/**
 * Service worker — persist defaults and open options from the toolbar.
 */

const DEFAULTS = {
  profile: "default",
  stepSize: 100,
  animationTime: 400,
  accelerationMax: 3,
  accelerationScale: 3,
  accelerationDelta: 50,
  pulseScale: 4,
  arrowScroll: 50,
  keyboardSupport: true,
  touchpadSupport: false,
  pulseAlgorithm: true,
  middleMouse: true,
  frameRate: 150,
};

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.sync.get(null);
  if (!stored || Object.keys(stored).length === 0) {
    await chrome.storage.sync.set(DEFAULTS);
  } else {
    const patch = {};
    if (stored.accelerationScale == null && stored.accelerationMax != null) {
      patch.accelerationScale = stored.accelerationMax;
    }
    // Migrate older 120 default toward store Default (100) only when still on stock 120
    if (
      details.reason === "update" &&
      stored.stepSize === 120 &&
      (stored.profile === "default" || stored.profile == null)
    ) {
      patch.stepSize = 100;
    }
    if (Object.keys(patch).length) {
      await chrome.storage.sync.set(patch);
    }
  }
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
