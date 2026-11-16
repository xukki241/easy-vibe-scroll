/**
 * MAIN-world bridge — intercept page-initiated scrollIntoView / scrollTo
 * so Smooth Scroll Free can animate them from the isolated content script.
 * Clean-room; not proprietary SmoothScroll source.
 */
(() => {
  "use strict";
  if (window.__ssfPageBridge) return;
  window.__ssfPageBridge = true;

  const EVT = "ssf:smooth-scroll";

  function hostEndsWith(suffix) {
    const h = (location.hostname || "").toLowerCase();
    return h === suffix || h.endsWith("." + suffix);
  }

  /** Match content.js snap-feed bypass — leave native Shorts/Reels alone */
  function isSnapFeedPath() {
    try {
      const path = location.pathname || "";
      if (
        hostEndsWith("youtube.com") ||
        hostEndsWith("youtube-nocookie.com")
      ) {
        if (/^\/shorts\b/i.test(path)) return true;
      }
      if (hostEndsWith("instagram.com")) {
        if (/\/(reels?|stories)\b/i.test(path)) return true;
      }
      if (hostEndsWith("facebook.com") || hostEndsWith("fb.com")) {
        if (/\/(reel|reels|share\/r)\b/i.test(path)) return true;
      }
      if (hostEndsWith("tiktok.com")) return true;
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function offer(target, kind, detail) {
    if (isSnapFeedPath()) return false;
    try {
      const ev = new CustomEvent(EVT, {
        bubbles: true,
        cancelable: true,
        detail: Object.assign({ kind }, detail || {}),
      });
      return !target.dispatchEvent(ev);
    } catch (_) {
      return false;
    }
  }

  const nativeIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoView(arg) {
    const handled = offer(this, "scrollIntoView", { arg: null });
    if (handled) return;
    return nativeIntoView.apply(this, arguments);
  };

  if (typeof window.scrollTo === "function") {
    const nativeScrollTo = window.scrollTo.bind(window);
    window.scrollTo = function scrollTo(a, b) {
      // Only intercept explicit smooth scrollTo — leave instant restores alone
      if (a != null && typeof a === "object" && a.behavior === "smooth") {
        const handled = offer(document.documentElement, "scrollTo", {
          x: Number(a.left) || 0,
          y: Number(a.top) || 0,
        });
        if (handled) return;
      }
      return nativeScrollTo.apply(window, arguments);
    };
  }
})();
