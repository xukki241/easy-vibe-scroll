/**
 * Service worker — persist defaults and open options from the toolbar.
 */

const DEFAULTS = {
  profile: "default",
  stepSize: 120,
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
  } else if (stored.accelerationScale == null && stored.accelerationMax != null) {
    await chrome.storage.sync.set({ accelerationScale: stored.accelerationMax });
  }
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
