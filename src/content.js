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
  let pulseNormalize = 1;
  let animGen = 0;
  let ignoreHashChange = false;
  let lastHashNav = 0;
  let autoScroll = null; // middle-mouse autoscroll state
  let bridgeBurst = 0;
  let bridgeBurstReset = 0;
  let moveListening = false;
  let overflowCacheEl = null;
  let overflowCacheResult = null;
  let overflowCacheAt = 0;
  let stickyPadCache = 0;
  let stickyPadAt = 0;
  let hostFlags = null; // lazy { heavySpa, snapPath }
  let cssSmoothDepth = 0;
  const MAX_QUE = 4;
  const OVERFLOW_CACHE_MS = 320;

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
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  function hostEndsWith(suffix) {
    const h = (location.hostname || "").toLowerCase();
    return h === suffix || h.endsWith("." + suffix);
  }

  function getHostFlags() {
    // Cache only host classification; re-read pathname (cheap) for Shorts/Reels
    if (!hostFlags) {
      hostFlags = {
        heavySpa:
          hostEndsWith("facebook.com") ||
          hostEndsWith("fb.com") ||
          hostEndsWith("instagram.com") ||
          hostEndsWith("youtube.com") ||
          hostEndsWith("youtube-nocookie.com") ||
          hostEndsWith("twitter.com") ||
          hostEndsWith("x.com") ||
          hostEndsWith("linkedin.com") ||
          hostEndsWith("reddit.com") ||
          hostEndsWith("tiktok.com") ||
          hostEndsWith("threads.net") ||
          hostEndsWith("pinterest.com") ||
          hostEndsWith("tumblr.com"),
      };
    }
    const path = location.pathname || "";
    let snapPath = false;
    if (
      hostEndsWith("youtube.com") ||
      hostEndsWith("youtube-nocookie.com")
    ) {
      snapPath = /^\/shorts\b/i.test(path);
    } else if (hostEndsWith("instagram.com")) {
      snapPath = /\/(reels?|stories)\b/i.test(path);
    } else if (hostEndsWith("facebook.com") || hostEndsWith("fb.com")) {
      snapPath = /\/(reel|reels|share\/r)\b/i.test(path);
    } else if (hostEndsWith("tiktok.com")) {
      snapPath = true;
    }
    return { heavySpa: hostFlags.heavySpa, snapPath };
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

  function overflowAllows(axisValue) {
    return (
      axisValue === "auto" ||
      axisValue === "scroll" ||
      axisValue === "overlay"
    );
  }

  /**
   * @param {Element} node
   * @param {'x'|'y'|'either'} [axis]
   */
  function isScrollable(node, axis) {
    if (!node || node.nodeType !== 1) return false;
    const dy = node.clientHeight + 10 < node.scrollHeight;
    const dx = node.clientWidth + 10 < node.scrollWidth;
    if (!dy && !dx) return false;

    let style;
    try {
      style = getComputedStyle(node);
    } catch (_) {
      return false;
    }
    // Fixed chrome (sticky footers/headers) rarely owns page scroll
    if (style.position === "fixed") return false;
    const canY = dy && overflowAllows(style.overflowY);
    const canX = dx && overflowAllows(style.overflowX);
    if (axis === "y") return canY;
    if (axis === "x") return canX;
    return canY || canX;
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

  function wheelAxis(x, y) {
    if (Math.abs(y) >= Math.abs(x)) return "y";
    if (x) return "x";
    return "y";
  }

  function overflowingAncestor(el, axis) {
    const t = now();
    const axisKey = axis || "either";
    if (
      el &&
      el === overflowCacheEl &&
      t - overflowCacheAt < OVERFLOW_CACHE_MS &&
      overflowCacheResult &&
      overflowCacheResult._ssfAxis === axisKey
    ) {
      return overflowCacheResult.node;
    }

    const body = document.body;
    const html = document.documentElement;
    if (!el || !body) return documentScroller();
    if (el.nodeType === 3) el = el.parentElement;

    const flags = getHostFlags();
    // Heavy SPAs: shallow walk. Long marketing pages: full walk but axis-aware
    // so horizontal carousels / overflow-x strips don't steal vertical wheel.
    const maxDepth = flags.heavySpa ? 6 : 48;
    let node = el;
    let depth = 0;
    while (
      node &&
      node !== body &&
      node !== html &&
      node !== document &&
      depth < maxDepth
    ) {
      if (isScrollable(node, axisKey === "either" ? "either" : axisKey)) {
        overflowCacheEl = el;
        overflowCacheResult = { node, _ssfAxis: axisKey };
        overflowCacheAt = t;
        return node;
      }
      node = node.parentElement;
      depth++;
    }

    if (isFrame) {
      if (isScrollable(body, axisKey === "either" ? "either" : axisKey)) {
        return body;
      }
      if (isScrollable(html, axisKey === "either" ? "either" : axisKey)) {
        return html;
      }
      return documentScroller();
    }

    const scroller = documentScroller();
    overflowCacheEl = el;
    overflowCacheResult = { node: scroller, _ssfAxis: axisKey };
    overflowCacheAt = t;
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

  function suppressCssSmoothScroll() {
    if (cssSmoothDepth++) return;
    const html = document.documentElement;
    const body = document.body;
    try {
      if (html) {
        html.setAttribute(
          "data-ssf-sb",
          html.style.getPropertyValue("scroll-behavior") || ""
        );
        html.style.setProperty("scroll-behavior", "auto", "important");
      }
      if (body) {
        body.setAttribute(
          "data-ssf-sb",
          body.style.getPropertyValue("scroll-behavior") || ""
        );
        body.style.setProperty("scroll-behavior", "auto", "important");
      }
    } catch (_) {
      /* ignore */
    }
  }

  function restoreCssSmoothScroll() {
    if (cssSmoothDepth <= 0) return;
    if (--cssSmoothDepth > 0) return;
    cssSmoothDepth = 0;
    const restore = (el) => {
      if (!el || !el.hasAttribute("data-ssf-sb")) return;
      const prev = el.getAttribute("data-ssf-sb") || "";
      el.removeAttribute("data-ssf-sb");
      try {
        if (prev) el.style.setProperty("scroll-behavior", prev);
        else el.style.removeProperty("scroll-behavior");
      } catch (_) {
        /* ignore */
      }
    };
    restore(document.documentElement);
    restore(document.body);
  }

  function scrollByInstant(target, dx, dy) {
    if (!dx && !dy) return;
    const optsInstant = { left: dx, top: dy, behavior: "instant" };
    const optsAuto = { left: dx, top: dy, behavior: "auto" };
    try {
      target.scrollBy(optsInstant);
      return;
    } catch (_) {
      /* older engines */
    }
    try {
      target.scrollBy(optsAuto);
      return;
    } catch (_) {
      /* ignore */
    }
    if (target === window) {
      window.scrollBy(dx, dy);
    } else {
      if (dx) target.scrollLeft += dx;
      if (dy) target.scrollTop += dy;
    }
  }

  function applyScroll(elem, dx, dy) {
    if (!dx && !dy) return;
    // Marketing pages often set html { scroll-behavior: smooth }. Incremental
    // rAF scrollBy must be instant or the browser re-eases every frame → jank.
    if (isWindowScroller(elem)) {
      scrollByInstant(window, dx, dy);
      return;
    }
    if (typeof elem.scrollBy === "function") {
      scrollByInstant(elem, dx, dy);
      return;
    }
    if (dx) elem.scrollLeft += dx;
    if (dy) elem.scrollTop += dy;
  }

  function cancelAnimation() {
    que = [];
    animGen += 1;
    if (pending) {
      pending = false;
      restoreCssSmoothScroll();
    }
  }

  function scrollArray(elem, left, top, opts) {
    const accelerate = !opts || opts.accelerate !== false;
    if (opts && opts.replace) {
      cancelAnimation();
    }

    directionCheck(left, top);

    if (accelerate && options.accelerationMax > 1) {
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
    } else {
      lastScroll = now();
    }

    const gen = animGen;
    que.push({
      x: left,
      y: top,
      lastX: left < 0 ? 0.99 : -0.99,
      lastY: top < 0 ? 0.99 : -0.99,
      start: now(),
    });
    // Bound impulse queue so rapid notches on heavy pages don't O(n) explode
    while (que.length > MAX_QUE) {
      que.shift();
    }

    if (pending) return;
    pending = true;
    suppressCssSmoothScroll();

    // Continuous rAF impulse loop — new wheel notches push onto `que`
    // while this runs, so motion accumulates like classic SmoothScroll.
    const step = () => {
      // Superseded by cancelAnimation / replace — that path owns CSS restore
      if (gen !== animGen) return;
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

      if (gen !== animGen) return;

      if (que.length) {
        requestFrame(step);
      } else {
        pending = false;
        restoreCssSmoothScroll();
      }
    };

    requestFrame(step);
  }

  function parsePx(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  function stickyTopOffset(scroller) {
    const t = now();
    if (t - stickyPadAt < 1000) return stickyPadCache;

    let pad = 0;
    try {
      const host = isWindowScroller(scroller)
        ? document.documentElement
        : scroller;
      pad = Math.max(pad, parsePx(getComputedStyle(host).scrollPaddingTop));
    } catch (_) {
      /* ignore */
    }

    // Skip expensive querySelectorAll on heavy SPAs (anchor nav is rare there)
    if (!isWindowScroller(scroller) || getHostFlags().heavySpa) {
      stickyPadCache = pad;
      stickyPadAt = t;
      return pad;
    }

    try {
      const nodes = document.body
        ? document.body.querySelectorAll("header, nav")
        : [];
      let maxBottom = 0;
      const limit = Math.min(nodes.length, 12);
      for (let i = 0; i < limit; i++) {
        const el = nodes[i];
        const st = getComputedStyle(el);
        if (st.position !== "fixed" && st.position !== "sticky") continue;
        if (st.visibility === "hidden" || st.display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.width <= 0) continue;
        if (r.top > 8 || r.bottom <= 0) continue;
        if (r.height > window.innerHeight * 0.45) continue;
        if (r.bottom > maxBottom) maxBottom = r.bottom;
      }
      pad = Math.max(pad, maxBottom);
    } catch (_) {
      /* ignore */
    }
    stickyPadCache = pad;
    stickyPadAt = t;
    return pad;
  }

  function currentScroll(scroller) {
    if (isWindowScroller(scroller)) {
      return {
        x: window.scrollX || window.pageXOffset || 0,
        y: window.scrollY || window.pageYOffset || 0,
      };
    }
    return { x: scroller.scrollLeft, y: scroller.scrollTop };
  }

  function targetOffsetInScroller(scroller, el) {
    const cur = currentScroll(scroller);
    if (!el) {
      return { x: 0, y: 0, curX: cur.x, curY: cur.y };
    }

    const marginTop = parsePx(getComputedStyle(el).scrollMarginTop);
    const marginLeft = parsePx(getComputedStyle(el).scrollMarginLeft);
    const padTop = stickyTopOffset(scroller);
    const rect = el.getBoundingClientRect();

    if (isWindowScroller(scroller)) {
      return {
        x: rect.left + cur.x - marginLeft,
        y: rect.top + cur.y - marginTop - padTop,
        curX: cur.x,
        curY: cur.y,
      };
    }

    const sRect = scroller.getBoundingClientRect();
    return {
      x: scroller.scrollLeft + (rect.left - sRect.left) - marginLeft,
      y: scroller.scrollTop + (rect.top - sRect.top) - marginTop - padTop,
      curX: cur.x,
      curY: cur.y,
    };
  }

  function resolveHashTarget(rawHash) {
    let hash = rawHash == null ? "" : String(rawHash);
    if (hash.charAt(0) === "#") hash = hash.slice(1);
    try {
      hash = decodeURIComponent(hash);
    } catch (_) {
      /* keep raw */
    }
    if (!hash || hash.toLowerCase() === "top") {
      return { kind: "top" };
    }

    let el = document.getElementById(hash);
    if (!el) {
      const named = document.getElementsByName(hash);
      if (named && named.length) el = named[0];
    }
    if (!el && typeof CSS !== "undefined" && CSS.escape) {
      try {
        el = document.querySelector("#" + CSS.escape(hash));
      } catch (_) {
        /* ignore */
      }
    }
    if (!el) return null;
    return { kind: "element", el };
  }

  function sameDocumentHref(anchor) {
    const hrefAttr = anchor.getAttribute("href");
    if (hrefAttr == null || hrefAttr === "") return null;
    if (anchor.hasAttribute("download")) return null;
    const targetAttr = anchor.getAttribute("target");
    if (targetAttr && targetAttr !== "_self") return null;

    if (hrefAttr === "#" || hrefAttr === "#top") return hrefAttr;
    if (hrefAttr.charAt(0) === "#") return hrefAttr;

    if (hrefAttr.indexOf("#") === -1) return null;

    let url;
    try {
      url = new URL(hrefAttr, location.href);
    } catch (_) {
      return null;
    }
    if (url.origin !== location.origin) return null;
    if (url.pathname !== location.pathname) return null;
    if (url.search !== location.search) return null;
    return url.hash || "#";
  }

  function setHashWithoutJump(hash) {
    const next = !hash || hash === "#" ? "" : hash.charAt(0) === "#" ? hash : "#" + hash;
    ignoreHashChange = true;
    lastHashNav = now();
    try {
      if (history.pushState) {
        history.pushState(
          null,
          "",
          location.pathname + location.search + next
        );
      } else if (next) {
        location.hash = next;
      }
    } catch (_) {
      try {
        if (next) location.hash = next;
      } catch (__) {
        /* ignore */
      }
    }
    setTimeout(() => {
      ignoreHashChange = false;
    }, 0);
  }

  function smoothScrollToResolved(resolved) {
    if (!resolved) return false;
    const el = resolved.kind === "element" ? resolved.el : null;
    const scroller = el
      ? overflowingAncestor(el)
      : documentScroller();
    const dest = targetOffsetInScroller(scroller, el);
    const dx = dest.x - dest.curX;
    const dy = dest.y - dest.curY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return true;

    scrollArray(scroller, dx, dy, { replace: true, accelerate: false });

    if (el && typeof el.focus === "function") {
      try {
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        el.focus({ preventScroll: true });
      } catch (_) {
        /* ignore */
      }
    }
    return true;
  }

  function navigateToHash(hash, { updateHistory } = { updateHistory: true }) {
    if (!enabled) return false;
    const resolved = resolveHashTarget(hash);
    if (!resolved) return false;
    if (updateHistory) {
      const normalized =
        resolved.kind === "top"
          ? "#"
          : "#" + (hash.charAt(0) === "#" ? hash.slice(1) : hash);
      setHashWithoutJump(normalized);
    }
    return smoothScrollToResolved(resolved);
  }

  function onAnchorClick(event) {
    if (!enabled || event.defaultPrevented) return;
    if (event.button === 0 && autoScroll) stopAutoScroll();
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    let node = event.target;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (shouldBypassSmooth(node)) return;
    const anchor = node && node.closest ? node.closest("a[href]") : null;
    if (!anchor || anchor.closest("svg")) return;

    const hash = sameDocumentHref(anchor);
    if (hash == null) return;

    const resolved = resolveHashTarget(hash);
    if (!resolved) return;

    // Prevent the browser's instant #hash jump; allow page listeners to bubble
    // (TOC active-state, analytics) — scrollIntoView from those hits the bridge.
    event.preventDefault();
    navigateToHash(hash, { updateHistory: true });
  }

  function onHashChange() {
    if (!enabled) return;
    if (ignoreHashChange) {
      ignoreHashChange = false;
      return;
    }
    // Avoid double-handling right after our own pushState fallback
    if (now() - lastHashNav < 50) return;
    navigateToHash(location.hash, { updateHistory: false });
  }

  function hasSnapAncestor(el) {
    // Cheap tag/id checks first; getComputedStyle only a few levels
    let node = el;
    for (let i = 0; i < 8 && node && node.nodeType === 1; i++) {
      const tag = node.tagName || "";
      if (/SHORTS/i.test(tag)) return true;
      const id = node.id || "";
      if (
        id === "shorts-container" ||
        id === "shorts-inner-container" ||
        id === "reel_feed"
      ) {
        return true;
      }
      try {
        const snap = getComputedStyle(node).scrollSnapType;
        if (snap && snap !== "none") return true;
      } catch (_) {
        /* ignore */
      }
      node = node.parentElement;
    }
    return false;
  }

  function shouldBypassSmooth(target) {
    const flags = getHostFlags();
    if (flags.snapPath) return true;
    // Avoid deep snap walks on Facebook/etc. home feeds (path already not snap)
    if (flags.heavySpa) return false;
    if (target && hasSnapAncestor(target)) return true;
    return false;
  }

  function onBridgeScroll(event) {
    if (!enabled) return;
    // Bridge is not installed on heavy SPAs; ignore stray events
    if (getHostFlags().heavySpa) return;
    const detail = event.detail || {};
    if (detail.kind !== "scrollIntoView" && detail.kind !== "scrollTo") return;

    // Leave native behavior on snap feeds; do not cancel the MAIN-world event
    if (shouldBypassSmooth(event.target)) return;

    const t = now();
    if (t > bridgeBurstReset) {
      bridgeBurst = 0;
      bridgeBurstReset = t + 1000;
    }
    // Rate-limit spoofed CustomEvents from the page (Low: nuisance scroll)
    if (++bridgeBurst > 48) return;

    if (detail.kind === "scrollIntoView") {
      const el = event.target;
      if (!el || el.nodeType !== 1) return;
      event.preventDefault();
      smoothScrollToResolved({ kind: "element", el });
      return;
    }
    if (detail.kind === "scrollTo") {
      event.preventDefault();
      const scroller = documentScroller();
      const cur = currentScroll(scroller);
      const dx = (Number(detail.x) || 0) - cur.x;
      const dy = (Number(detail.y) || 0) - cur.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      scrollArray(scroller, dx, dy, { replace: true, accelerate: false });
    }
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

    // Shorts / Reels / scroll-snap feeds: do not preventDefault — native snap wins
    if (shouldBypassSmooth(target)) return;

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

    if (!x && !y) return;

    const axis = wheelAxis(x, y);
    const elem = overflowingAncestor(
      target || activeElement || document.body,
      axis
    );
    if (!elem) return;

    // If nested container can't move further, bubble to parent/document
    const scroller = climbIfAtEdge(elem, x, y, axis);
    event.preventDefault();
    scrollArray(scroller, x, y);
  }

  function canScrollInDirection(node, x, y) {
    if (isWindowScroller(node)) {
      // Document: only claim vertical room when the page can actually move
      if (y < 0) return (window.scrollY || window.pageYOffset || 0) > 0;
      if (y > 0) {
        const se = documentScroller();
        const top = window.scrollY || window.pageYOffset || 0;
        const max = Math.max(
          0,
          (se ? se.scrollHeight : 0) - window.innerHeight
        );
        return top < max - 1;
      }
      if (x < 0) return (window.scrollX || window.pageXOffset || 0) > 0;
      if (x > 0) {
        const se = documentScroller();
        const left = window.scrollX || window.pageXOffset || 0;
        const max = Math.max(
          0,
          (se ? se.scrollWidth : 0) - window.innerWidth
        );
        return left < max - 1;
      }
      return false;
    }
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

  function climbIfAtEdge(elem, x, y, axis) {
    let node = elem;
    for (let depth = 0; depth < 10; depth++) {
      if (canScrollInDirection(node, x, y)) {
        return isWindowScroller(node) ? documentScroller() : node;
      }
      const parentEl = node.parentElement || document.body;
      const parent = overflowingAncestor(parentEl, axis || wheelAxis(x, y));
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

  function setMoveListening(on) {
    if (on && !moveListening) {
      window.addEventListener("mousemove", mousemove, {
        capture: true,
        passive: true,
      });
      moveListening = true;
    } else if (!on && moveListening) {
      window.removeEventListener("mousemove", mousemove, true);
      moveListening = false;
    }
  }

  function stopAutoScroll() {
    if (!autoScroll) {
      setMoveListening(false);
      return;
    }
    if (autoScroll.raf) {
      try {
        if (window.cancelAnimationFrame) cancelAnimationFrame(autoScroll.raf);
        else clearTimeout(autoScroll.raf);
      } catch (_) {
        /* ignore */
      }
    }
    if (autoScroll.marker && autoScroll.marker.parentNode) {
      autoScroll.marker.parentNode.removeChild(autoScroll.marker);
    }
    autoScroll = null;
    setMoveListening(false);
  }

  function ensureAutoScrollMarker(x, y) {
    const id = "ssf-autoscroll-marker";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.setAttribute("aria-hidden", "true");
      el.style.cssText =
        "position:fixed;z-index:2147483647;width:28px;height:28px;margin:-14px 0 0 -14px;" +
        "border:2px solid #2f6fed;border-radius:50%;background:rgba(47,111,237,.15);" +
        "pointer-events:none;box-shadow:0 0 0 1px rgba(255,255,255,.8);";
      (document.documentElement || document.body).appendChild(el);
    }
    el.style.left = x + "px";
    el.style.top = y + "px";
    return el;
  }

  function startAutoScroll(clientX, clientY, scroller) {
    stopAutoScroll();
    cancelAnimation();
    const marker = ensureAutoScrollMarker(clientX, clientY);
    autoScroll = {
      originX: clientX,
      originY: clientY,
      scroller: scroller || documentScroller(),
      vx: 0,
      vy: 0,
      marker,
      raf: 0,
    };
    setMoveListening(true);

    const tick = () => {
      if (!autoScroll) return;
      const { vx, vy, scroller: sc } = autoScroll;
      if (vx || vy) applyScroll(sc, vx, vy);
      // Keep rAF only while autoscroll mode is on (mousemove updates vx/vy)
      autoScroll.raf = requestFrame(tick);
    };
    autoScroll.raf = requestFrame(tick);
  }

  function mousedown(event) {
    activeElement = event.target;
    if (event.button !== 1 || !options.middleMouse) return;
    if (isEditable(event.target)) return;
    if (shouldBypassSmooth(event.target)) return;

    // Click-to-toggle autoscroll (direct applyScroll — not pulse queue)
    event.preventDefault();
    if (autoScroll) {
      stopAutoScroll();
      return;
    }
    const scroller = overflowingAncestor(
      event.target || activeElement || document.body
    );
    startAutoScroll(event.clientX, event.clientY, scroller);
  }

  function mouseup(event) {
    // Keep autoscroll until a second middle-click (handled in mousedown)
    if (event.button === 1 && options.middleMouse) {
      event.preventDefault();
    }
  }

  function auxclick(event) {
    // Stop Chromium's native middle-click autoscroll / open-link when we own it
    if (event.button === 1 && options.middleMouse) {
      event.preventDefault();
    }
  }

  function mousemove(event) {
    if (!autoScroll || !options.middleMouse) return;
    const dx = event.clientX - autoScroll.originX;
    const dy = event.clientY - autoScroll.originY;
    const dead = 10;
    const scale = 0.12;
    autoScroll.vx =
      Math.abs(dx) > dead ? (dx - Math.sign(dx) * dead) * scale : 0;
    autoScroll.vy =
      Math.abs(dy) > dead ? (dy - Math.sign(dy) * dead) * scale : 0;
  }

  function keydownStopAutoScroll(event) {
    if (autoScroll && event.keyCode === 27) stopAutoScroll();
  }

  function clamp(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  function applySettings(settings) {
    options = { ...DEFAULTS, ...settings };
    if (settings && settings.accelerationScale != null) {
      options.accelerationMax = Number(settings.accelerationScale);
    }
    options.accelerationMax = clamp(
      options.accelerationMax,
      1,
      10,
      DEFAULTS.accelerationMax
    );
    options.stepSize = clamp(options.stepSize, 1, 1000, DEFAULTS.stepSize);
    options.animationTime = clamp(
      options.animationTime,
      50,
      2000,
      DEFAULTS.animationTime
    );
    options.accelerationDelta = clamp(
      options.accelerationDelta,
      1,
      500,
      DEFAULTS.accelerationDelta
    );
    options.pulseScale = clamp(options.pulseScale, 0.5, 20, DEFAULTS.pulseScale);
    options.arrowScroll = clamp(
      options.arrowScroll,
      1,
      500,
      DEFAULTS.arrowScroll
    );
    options.frameRate = clamp(options.frameRate, 30, 240, DEFAULTS.frameRate);
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
    if (!options.middleMouse) stopAutoScroll();
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
    window.addEventListener("keydown", keydownStopAutoScroll, true);
    window.addEventListener("mousedown", mousedown, true);
    window.addEventListener("mouseup", mouseup, true);
    window.addEventListener("auxclick", auxclick, true);
    // mousemove is attached lazily only while middle-mouse autoscroll is active
    window.addEventListener("blur", stopAutoScroll, true);
    // In-page TOC / hash links (capture before the browser's instant jump)
    document.addEventListener("click", onAnchorClick, true);
    window.addEventListener("hashchange", onHashChange, false);
    // MAIN-world bridge events — skipped on heavy SPAs (bridge not installed)
    if (!getHostFlags().heavySpa) {
      document.addEventListener("ssf:smooth-scroll", onBridgeScroll, true);
    }

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
