/**
 * Smooth Scroll Free — content script (Manifest V3)
 *
 * Clean-room reimplementation of smooth wheel/keyboard scrolling.
 * Pulse easing follows the publicly documented “stopping” impulse model
 * (Michael Herf / stereopsis), not proprietary SmoothScroll source.
 */
(() => {
  "use strict";

  const DEFAULTS = {
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
  };

  let options = { ...DEFAULTS };
  let enabled = true;

  let root = document.documentElement;
  let activeElement = null;
  let isFrame = false;
  let initDone = false;
  let direction = { x: 0, y: 0 };
  let que = [];
  let pending = false;
  let lastScroll = Date.now();
  let deltaBuffer = [];
  let deltaBufferTimer = null;
  let middleDown = false;
  let middleLast = null;

  const KEY = {
    left: 37,
    up: 38,
    right: 39,
    down: 40,
    spacebar: 32,
    pageup: 33,
    pagedown: 34,
    end: 35,
    home: 36,
  };

  const isMac = /^Mac/i.test(navigator.platform || navigator.userAgentData?.platform || "");

  let pulseNormalize = 1;

  function pulse_(x) {
    let val;
    let start;
    let expx;
    x *= options.pulseScale;
    if (x < 1) {
      val = x - (1 - Math.exp(-x));
    } else {
      start = Math.exp(-1);
      x -= 1;
      expx = 1 - Math.exp(-x);
      val = start + expx * (1 - start);
    }
    return val * pulseNormalize;
  }

  function pulse(x) {
    if (x >= 1) return 1;
    if (x <= 0) return 0;
    if (pulseNormalize === 1) {
      pulseNormalize /= pulse_(1);
    }
    return pulse_(x);
  }

  function now() {
    return Date.now();
  }

  function isNodeName(el, tag) {
    return el && el.nodeName && el.nodeName.toLowerCase() === tag.toLowerCase();
  }

  function directionCheck(x, y) {
    x = x > 0 ? 1 : -1;
    y = y > 0 ? 1 : -1;
    if (direction.x !== x || direction.y !== y) {
      direction.x = x;
      direction.y = y;
      que = [];
      lastScroll = 0;
    }
  }

  function isTouchpad(deltaY) {
    if (!deltaY) return false;
    if (!deltaBuffer.length) {
      deltaBuffer = [deltaY, deltaY, deltaY];
    }
    deltaBuffer.push(deltaY);
    deltaBuffer.shift();
    clearTimeout(deltaBufferTimer);
    deltaBufferTimer = setTimeout(() => {
      deltaBuffer = [];
    }, 1500);
    const allDivisible = (n) =>
      Math.abs(n % 120) < 1e-6 || Math.abs(n % 100) < 1e-6;
    return !deltaBuffer.every(allDivisible);
  }

  function overflowingAncestor(el) {
    const body = document.body;
    const html = document.documentElement;

    function overflowed(node) {
      const style = getComputedStyle(node);
      return /auto|scroll|overlay/.test(
        style.overflow + style.overflowY + style.overflowX
      );
    }

    if (!isFrame && root.scrollHeight === (el && el.scrollHeight)) {
      return document.scrollingElement || html || body;
    }

    let node = el;
    while (node && node !== body && node !== html && node !== document) {
      if (node.clientHeight + 10 < node.scrollHeight && overflowed(node)) {
        return node;
      }
      node = node.parentElement || node.parentNode;
    }
    return document.scrollingElement || root;
  }

  function isEditable(el) {
    return (
      el &&
      (el.isContentEditable ||
        isNodeName(el, "input") ||
        isNodeName(el, "textarea") ||
        isNodeName(el, "select") ||
        (el.getAttribute && el.getAttribute("role") === "textbox"))
    );
  }

  function scrollArray(elem, left, top) {
    directionCheck(left, top);

    if (options.accelerationMax > 1) {
      const elapsed = now() - lastScroll;
      if (elapsed < options.accelerationDelta && elapsed > 0) {
        const factor = (1 + 50 / elapsed) / 2;
        if (factor > 1) {
          const capped = Math.min(factor, options.accelerationMax);
          left *= capped;
          top *= capped;
        }
      }
      lastScroll = now();
    }

    que.push({
      x: left,
      y: top,
      lastX: left < 0 ? 0.99 : -0.99,
      lastY: top < 0 ? 0.99 : -0.99,
      start: now(),
    });

    if (pending) return;

    const scrollWindow =
      elem === document.body ||
      elem === document.documentElement ||
      elem === document.scrollingElement;

    const requestFrame = window.requestAnimationFrame.bind(window);

    const step = function (time) {
      const finished = [];
      let dx = 0;
      let dy = 0;

      for (let i = 0; i < que.length; i++) {
        const item = que[i];
        const t = (now() - item.start) / options.animationTime;
        const progress = t < 1 ? t : 1;
        const easing = options.pulseAlgorithm ? pulse(progress) : progress;
        const x = (item.x * easing - item.lastX) >> 0;
        const y = (item.y * easing - item.lastY) >> 0;

        dx += x;
        dy += y;
        item.lastX += x;
        item.lastY += y;

        if (progress === 1) finished.push(i);
      }

      if (scrollWindow) {
        window.scrollBy(dx, dy);
      } else {
        if (dx) elem.scrollLeft += dx;
        if (dy) elem.scrollTop += dy;
      }

      for (let j = finished.length - 1; j >= 0; j--) {
        que.splice(finished[j], 1);
      }

      if (que.length) {
        requestFrame(() => step(time));
      } else {
        pending = false;
      }
    };

    requestFrame(() => step(now()));
    pending = true;
  }

  function normalizeWheelDelta(event) {
    let deltaX = event.deltaX;
    let deltaY = event.deltaY;

    // Legacy wheelDelta (opposite sign convention)
    if (deltaX == null && event.wheelDeltaX != null) {
      deltaX = -event.wheelDeltaX;
    }
    if (deltaY == null && event.wheelDeltaY != null) {
      deltaY = -event.wheelDeltaY;
    }
    if (deltaY == null && event.wheelDelta != null) {
      deltaY = -event.wheelDelta;
    }

    deltaX = deltaX || 0;
    deltaY = deltaY || 0;

    if (event.deltaMode === 1) {
      deltaX *= 40;
      deltaY *= 40;
    } else if (event.deltaMode === 2) {
      deltaX *= 800;
      deltaY *= 800;
    }

    return { deltaX, deltaY };
  }

  function wheel(event) {
    if (!enabled || !initDone) return;
    // Don't fight pages that opt into native smooth/ctrl-zoom
    if (event.ctrlKey) return;

    let { deltaX, deltaY } = normalizeWheelDelta(event);

    if (!options.touchpadSupport && isTouchpad(deltaY)) {
      return;
    }

    const scale = options.stepSize / 120;
    deltaX *= scale;
    deltaY *= scale;

    const target = overflowingAncestor(activeElement || document.body);
    if (!target) return;

    if (deltaX || deltaY) {
      event.preventDefault();
      scrollArray(target, deltaX, deltaY);
    }
  }

  function keydown(event) {
    if (!enabled || !options.keyboardSupport) return;
    const target = event.target || event.srcElement;
    const modifier =
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (event.shiftKey && event.keyCode !== KEY.spacebar);

    if (
      modifier ||
      isEditable(target) ||
      isEditable(document.activeElement) ||
      event.defaultPrevented
    ) {
      return;
    }

    let x = 0;
    let y = 0;
    const elem = overflowingAncestor(activeElement || document.body);
    if (!elem) return;

    const clientHeight =
      elem === document.body || elem === document.documentElement
        ? window.innerHeight
        : elem.clientHeight;

    switch (event.keyCode) {
      case KEY.up:
        y = -options.arrowScroll;
        break;
      case KEY.down:
        y = options.arrowScroll;
        break;
      case KEY.spacebar:
        y = (event.shiftKey ? -1 : 1) * clientHeight * 0.9;
        break;
      case KEY.pageup:
        y = -clientHeight * 0.9;
        break;
      case KEY.pagedown:
        y = clientHeight * 0.9;
        break;
      case KEY.home:
        y = -elem.scrollTop;
        break;
      case KEY.end: {
        const dest = elem.scrollHeight - elem.scrollTop - clientHeight;
        y = dest > 0 ? dest + 10 : 0;
        break;
      }
      case KEY.left:
        x = -options.arrowScroll;
        break;
      case KEY.right:
        x = options.arrowScroll;
        break;
      default:
        return;
    }

    scrollArray(elem, x, y);
    event.preventDefault();
  }

  function mousedown(event) {
    activeElement = event.target;
    if (event.button === 1 && options.middleMouse) {
      if (isEditable(event.target) || isNodeName(event.target, "a")) return;
      middleDown = true;
      middleLast = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    }
  }

  function mouseup(event) {
    if (event.button === 1) {
      middleDown = false;
    }
  }

  function mousemove(event) {
    if (!middleDown || !options.middleMouse || !middleLast) return;
    const dx = event.clientX - middleLast.x;
    const dy = event.clientY - middleLast.y;
    middleLast = { x: event.clientX, y: event.clientY };
    const elem = overflowingAncestor(activeElement || document.body);
    if (!elem) return;
    if (dx || dy) scrollArray(elem, dx * 2, dy * 2);
  }

  function applySettings(settings) {
    options = { ...DEFAULTS, ...settings };
    if (settings && settings.accelerationScale != null) {
      options.accelerationMax = Number(settings.accelerationScale);
    }
    options.accelerationMax = Number(options.accelerationMax) || DEFAULTS.accelerationMax;
    options.stepSize = Number(options.stepSize) || DEFAULTS.stepSize;
    options.animationTime = Number(options.animationTime) || DEFAULTS.animationTime;
    options.accelerationDelta =
      Number(options.accelerationDelta) || DEFAULTS.accelerationDelta;
    options.pulseScale = Number(options.pulseScale) || DEFAULTS.pulseScale;
    options.arrowScroll = Number(options.arrowScroll) || DEFAULTS.arrowScroll;
    pulseNormalize = 1;
    enabled = true;
  }

  function init() {
    if (initDone || !document.documentElement) return;
    initDone = true;
    root =
      document.compatMode.indexOf("CSS") >= 0
        ? document.documentElement
        : document.body || document.documentElement;
    activeElement = document.body || document.documentElement;
    try {
      isFrame = top !== self;
    } catch (_) {
      isFrame = true;
    }

    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keydown, { passive: false });
    window.addEventListener("mousedown", mousedown, true);
    window.addEventListener("mouseup", mouseup, true);
    window.addEventListener("mousemove", mousemove, true);
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULTS, (stored) => {
        if (chrome.runtime.lastError) {
          chrome.storage.local.get(DEFAULTS, (local) => {
            applySettings(local || DEFAULTS);
          });
          return;
        }
        applySettings(stored || DEFAULTS);
      });
    } catch (_) {
      applySettings(DEFAULTS);
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      const next = { ...options };
      for (const [key, { newValue }] of Object.entries(changes)) {
        next[key] = newValue;
      }
      applySettings(next);
    });
  } catch (_) {
    /* ignore */
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
  setTimeout(init, 0);
  loadSettings();
})();
