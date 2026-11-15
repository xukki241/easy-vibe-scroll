# Smooth Scroll Free

Free, **MIT-licensed** Manifest V3 Chrome/Edge extension that adds smooth mouse-wheel scrolling and in-page `#hash` / TOC navigation with a pulse easing curve.

Inspired by the product feel of [SmoothScroll](https://smoothscroll.net/) (settings layout & behavior). This is a **clean-room** reimplementation — it does **not** contain proprietary SmoothScroll source code.

## Install (Load unpacked)

1. Clone this repository (or download the source folder).
2. Open Chrome/Edge → `chrome://extensions` / `edge://extensions`
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**
5. Select this project folder (the one that contains `manifest.json`)
6. Open the extension **Options** page to tune profiles and features.

### Reload after pull / update

1. `git pull` (or sync this branch)
2. Open `chrome://extensions`
3. Click **Reload** on **Smooth Scroll Free**
4. Refresh any open tabs (content scripts do not hot-swap)

## Features

- Smooth wheel scrolling with optional **pulse algorithm** (Herf-style impulse)
- Smooth **same-document anchor / TOC** jumps (`a[href^="#"]`, hashchange, `scrollIntoView`)
- Intercepts `wheel` early (`capture` + `{passive:false}`) on all frames
- Scrolls nested overflow containers, then bubbles at edges
- Accounts for sticky/fixed headers and `scroll-margin` / `scroll-padding` when easy
- Profiles: **Custom**, **Default**, **iPhone**, **Opera**, **IE**
- Settings: Step size, Animation time, Acceleration scale, Acceleration delta, Pulse Scale, Arrow key step size
- Toggles: keyboard support, touchpad support, pulse algorithm, middle mouse scrolling
- Settings persist via `chrome.storage.sync` (falls back gracefully)

## Default profile (store-aligned)

| Setting | Default |
| --- | --- |
| Step size | 100 px |
| Animation time | 400 ms |
| Acceleration scale | 3 |
| Acceleration delta | 50 ms |
| Pulse Scale | 4 |
| Pulse algorithm | on |
| Touchpad support | off |

## Test page

Open `test/scroll-demo.html` after loading the extension to compare page + nested overflow wheel feel and Contents `#hash` links.

## Project layout

```
manifest.json          Manifest V3
options.html/css/js    Settings UI
popup.html/js          Toolbar popup
src/content.js         Scroll engine (injected, isolated world)
src/page-bridge.js     MAIN-world scrollIntoView / smooth scrollTo bridge
src/background.js      Service worker
src/defaults.js        Defaults & profiles
test/scroll-demo.html  Manual feel check (wheel + TOC anchors)
icons/                 Extension icons
```

## License

MIT © 2026 Nguyễn Xuân Kiên

## Disclaimer

“SmoothScroll” is a trademark of its respective owners. This project is an independent free implementation and is not affiliated with smoothscroll.net.
