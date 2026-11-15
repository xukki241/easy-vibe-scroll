/**
 * Smooth Scroll Free — content script (Manifest V3)
 *
 * Clean-room smooth wheel/keyboard scrolling.
 * Pulse easing follows the publicly documented “stopping” impulse model
 * (Michael Herf / stereopsis). Not proprietary SmoothScroll source.
 */
(() => {
  "use strict";

  const DEFAULTS = {
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
  let lastScroll = 0;
  let deltaBuffer = [120, 120, 120];
  let deltaBufferTimer = null;
  let middleDown = false;
  let middleLast = null;
  let pulseNormalize = 1;

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

  const requestFrame =
    window.requestAnimationFrame ||
    ((cb) => window.setTimeout(cb, 1000 / 60));

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
    x = x > 0 ? 1 : x < 0 ? -1 : 0;
    y = y > 0 ? 1 : y < 0 ? -1 : 0;
    if (direction.x !== x || direction.y !== y) {
      direction.x = x;
      direction.y = y;
      que = [];
      lastScroll = 0;
    }
  }

  /**
   * Mouse wheels typically emit chunky ±120 wheelDelta units.
   * Trackpads emit irregular / high-frequency deltas.
   * Prefer wheelDelta for this heuristic (deltaY alone false-positives on Linux).
   */
  function isTouchpad(wheelDeltaSample) {
    if (!wheelDeltaSample) return false;
    deltaBuffer.push(wheelDeltaSample);
    if (deltaBuffer.length > 3) deltaBuffer.shift();
    clearTimeout(deltaBufferTimer);
    deltaBufferTimer = setTimeout(() => {
      deltaBuffer = [120, 120, 120];
    }, 1500);

    const allDivisibleBy120 = deltaBuffer.every(
      (n) => Math.abs(n) % 120 < 0.01 || Math.abs(Math.abs(n) % 120 - 120) < 0.01
    );
    return !allDivisibleBy120;
  }

  function canOverflow(node) {
    if (!node || node === document) return false;
    const style = getComputedStyle(node);
    return /auto|scroll|overlay/.test(
      `${style.overflow}${style.overflowY}${style.overflowX}`
    );
  }

  function isScrollable(node) {
    if (!node || node.nodeType !== 1) return false;
    const dy = node.clientHeight + 10 < node.scrollHeight;
    const dx = node.clientWidth + 10 < node.scrollWidth;
    return (dy || dx) && canOverflow(node);
  }

  function documentScroller() {
    return (
      document.scrollingElement ||
      (document.compatMode === "CSS1Compat"
        ? document.documentElement
        : document.body) ||
      document.documentElement
    );
  }

  function overflowingAncestor(el) {
    const body = document.body;
    const html = document.documentElement;
    if (!el || !body) return documentScroller();
    if (el.nodeType === 3) el = el.parentElement;

    let node = el;
    while (node && node !== body && node !== html && node !== document) {
      if (isScrollable(node)) return node;
      node = node.parentElement;
    }

    // Document / frame root
    if (isFrame) {
      if (isScrollable(body)) return body;
      if (isScrollable(html)) return html;
      return documentScroller();
    }

    const scroller = documentScroller();
    // Prefer the element that actually moves with window.scrollBy
    if (
      scroller.scrollHeight > window.innerHeight + 10 ||
      scroller.scrollWidth > window.innerWidth + 10
    ) {
      return scroller;
    }
    if (body && body.scrollHeight > window.innerHeight + 10) return body;
    return scroller;
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

  function isWindowScroller(elem) {
    if (!elem) return true;
    return (
      elem === document.body ||
      elem === document.documentElement ||
      elem === document.scrollingElement
    );
  }

  function applyScroll(elem, dx, dy) {
    if (!dx && !dy) return;
    if (isWindowScroller(elem)) {
      window.scrollBy(dx, dy);
      return;
    }
    if (dx) elem.scrollLeft += dx;
    if (dy) elem.scrollTop += dy;
  }

  function scrollArray(elem, left, top) {
    directionCheck(left, top);

    if (options.accelerationMax > 1) {
      const elapsed = now() - lastScroll;
      if (elapsed < options.accelerationDelta && elapsed > 0) {
        let factor = (1 + 50 / elapsed) / 2;
        if (factor > 1) {
          factor = Math.min(factor, options.accelerationMax);
          left *= factor;
          top *= factor;
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
    pending = true;

    // Continuous rAF impulse loop — new wheel notches push onto `que`
    // while this runs, so motion accumulates like classic SmoothScroll.
    const step = () => {
      const tNow = now();
      let dx = 0;
      let dy = 0;

      for (let i = 0; i < que.length; i++) {
        const item = que[i];
        const elapsed = tNow - item.start;
        const finished = elapsed >= options.animationTime;
        let position = finished ? 1 : elapsed / options.animationTime;
        if (options.pulseAlgorithm) position = pulse(position);

        const x = (item.x * position - item.lastX) >> 0;
        const y = (item.y * position - item.lastY) >> 0;
        dx += x;
        dy += y;
        item.lastX += x;
        item.lastY += y;

        if (finished) {
          que.splice(i, 1);
          i--;
        }
      }

      applyScroll(elem, dx, dy);

      if (que.length) {
        requestFrame(step);
      } else {
        pending = false;
      }
    };

    requestFrame(step);
  }

  /**
   * Normalize to legacy wheelDelta-style units (positive = scroll up).
   * Classic SmoothScroll feel is driven by ±120 notches × stepSize/120.
   */
  function normalizeWheel(event) {
    let deltaX = 0;
    let deltaY = 0;

    if (typeof event.wheelDeltaX === "number" || typeof event.wheelDeltaY === "number") {
      deltaX = event.wheelDeltaX || 0;
      deltaY = event.wheelDeltaY || 0;
    } else if (typeof event.wheelDelta === "number") {
      deltaY = event.wheelDelta;
    } else {
      // WheelEvent delta*: opposite sign, often pixel-mode
      let dx = event.deltaX || 0;
      let dy = event.deltaY || 0;
      if (event.deltaMode === 1) {
        dx *= 40;
        dy *= 40;
      } else if (event.deltaMode === 2) {
        dx *= 800;
        dy *= 800;
      }
      // Approximate legacy wheelDelta (~3× pixel delta on many platforms)
      deltaX = -dx;
      deltaY = -dy;
      if (Math.abs(deltaY) < 120 && Math.abs(deltaY) > 0) {
        // Quantize small pixel lines toward a notch so stepSize applies
        const sign = deltaY < 0 ? -1 : 1;
        if (Math.abs(dy) >= 40) deltaY = sign * 120;
      }
      if (Math.abs(deltaX) < 120 && Math.abs(deltaX) > 0) {
        const sign = deltaX < 0 ? -1 : 1;
        if (Math.abs(dx) >= 40) deltaX = sign * 120;
      }
    }

    return { deltaX, deltaY, sample: deltaY || deltaX };
  }

  function wheel(event) {
    if (!enabled) return;
    if (!initDone) init();
    if (event.ctrlKey || event.defaultPrevented) return;

    let target = event.target;
    if (target && target.nodeType === 3) target = target.parentElement;
    if (
      isNodeName(activeElement, "embed") ||
      (isNodeName(target, "embed") && /\.pdf/i.test(target.src || ""))
    ) {
      return;
    }

    const { deltaX, deltaY, sample } = normalizeWheel(event);

    if (!options.touchpadSupport && isTouchpad(sample)) {
      return;
    }

    let x = deltaX;
    let y = deltaY;
    if (Math.abs(x) > 1.2) x *= options.stepSize / 120;
    if (Math.abs(y) > 1.2) y *= options.stepSize / 120;

    // Legacy wheelDelta is opposite window.scrollBy direction
    x = -x;
    y = -y;

    const elem = overflowingAncestor(target || activeElement || document.body);
    if (!elem) return;
    if (!x && !y) return;

    // If nested container can't move further, bubble to parent/document
    const scroller = climbIfAtEdge(elem, x, y);
    event.preventDefault();
    scrollArray(scroller, x, y);
  }

  function canScrollInDirection(node, x, y) {
    if (isWindowScroller(node)) return true;
    if (y < 0 && node.scrollTop > 0) return true;
    if (
      y > 0 &&
      Math.ceil(node.scrollTop + node.clientHeight) < node.scrollHeight
    ) {
      return true;
    }
    if (x < 0 && node.scrollLeft > 0) return true;
    if (
      x > 0 &&
      Math.ceil(node.scrollLeft + node.clientWidth) < node.scrollWidth
    ) {
      return true;
    }
    return !x && !y;
  }

  function climbIfAtEdge(elem, x, y) {
    let node = elem;
    for (let depth = 0; depth < 8; depth++) {
      if (canScrollInDirection(node, x, y)) {
        return isWindowScroller(node) ? documentScroller() : node;
      }
      const parent = overflowingAncestor(node.parentElement || document.body);
      if (!parent || parent === node) return documentScroller();
      node = parent;
    }
    return documentScroller();
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

    const clientHeight = isWindowScroller(elem)
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
        y = -(isWindowScroller(elem) ? window.scrollY : elem.scrollTop);
        break;
      case KEY.end: {
        const scrollTop = isWindowScroller(elem) ? window.scrollY : elem.scrollTop;
        const scrollHeight = isWindowScroller(elem)
          ? Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight
            )
          : elem.scrollHeight;
        const dest = scrollHeight - scrollTop - clientHeight;
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

    event.preventDefault();
    scrollArray(elem, x, y);
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
    if (event.button === 1) middleDown = false;
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
    options.accelerationMax =
      Number(options.accelerationMax) || DEFAULTS.accelerationMax;
    options.stepSize = Number(options.stepSize) || DEFAULTS.stepSize;
    options.animationTime =
      Number(options.animationTime) || DEFAULTS.animationTime;
    options.accelerationDelta =
      Number(options.accelerationDelta) || DEFAULTS.accelerationDelta;
    options.pulseScale = Number(options.pulseScale) || DEFAULTS.pulseScale;
    options.arrowScroll = Number(options.arrowScroll) || DEFAULTS.arrowScroll;
    options.frameRate = Number(options.frameRate) || DEFAULTS.frameRate;
    options.keyboardSupport = Boolean(
      settings?.keyboardSupport ?? options.keyboardSupport
    );
    options.touchpadSupport = Boolean(
      settings?.touchpadSupport ?? options.touchpadSupport
    );
    options.pulseAlgorithm = Boolean(
      settings?.pulseAlgorithm ?? options.pulseAlgorithm
    );
    options.middleMouse = Boolean(settings?.middleMouse ?? options.middleMouse);
    pulseNormalize = 1;
    enabled = true;
  }

  function init() {
    if (initDone) return;
    if (!document.documentElement) return;

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

    // Capture + non-passive so we win over page listeners and can preventDefault
    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    window.addEventListener("keydown", keydown, { passive: false, capture: true });
    window.addEventListener("mousedown", mousedown, true);
    window.addEventListener("mouseup", mouseup, true);
    window.addEventListener("mousemove", mousemove, true);

    initDone = true;
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

  // document_start: register immediately so the first wheel is intercepted
  init();
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        activeElement = document.body || document.documentElement;
        root =
          document.compatMode.indexOf("CSS") >= 0
            ? document.documentElement
            : document.body || document.documentElement;
      },
      { once: true }
    );
  }
  loadSettings();
})();
