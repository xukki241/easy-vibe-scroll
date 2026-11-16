/**
 * MAIN-world bridge — optional intercept of page scrollIntoView / smooth scrollTo.
 * Disabled on heavy SPAs (Facebook, etc.) where React virtualization calls these
 * constantly — overriding them causes severe jank.
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

  /** Virtualized / high-churn feeds — never patch prototypes here */
  function isHeavySpaHost() {
    return (
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
      hostEndsWith("tumblr.com")
    );
  }

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

  // Install nothing on heavy SPAs / snap feeds — leave native prototypes alone
  if (isHeavySpaHost() || isSnapFeedPath()) {
    return;
  }

  function offer(target, kind, detail) {
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
  Element.prototype.scrollIntoView = function scrollIntoView() {
    const handled = offer(this, "scrollIntoView", null);
    if (handled) return;
    return nativeIntoView.apply(this, arguments);
  };

  if (typeof window.scrollTo === "function") {
    const nativeScrollTo = window.scrollTo.bind(window);
    window.scrollTo = function scrollTo(a, b) {
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
