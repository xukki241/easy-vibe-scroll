# Smooth Scroll Free

Free, **MIT-licensed** Manifest V3 Chrome extension that adds smooth mouse-wheel scrolling with a pulse easing curve.

Inspired by the product feel of [SmoothScroll](https://smoothscroll.net/) (settings layout & behavior). This is a **clean-room** reimplementation — it does **not** contain proprietary SmoothScroll source code.

## Install (Load unpacked)

1. Clone this repository (or download the source folder).
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**
5. Select this project folder (the one that contains `manifest.json`)
6. Open the extension **Options** page to tune profiles and features.

## Features

- Smooth wheel scrolling with optional **pulse algorithm**
- Profiles: **Custom**, **Default**, **iPhone**, **Opera**, **IE**
- Settings: Step size, Animation time, Acceleration scale, Acceleration delta, Pulse Scale, Arrow key step size
- Toggles: keyboard support, touchpad support, pulse algorithm, middle mouse scrolling
- Settings persist via `chrome.storage.sync` (falls back gracefully)

## Project layout

```
manifest.json          Manifest V3
options.html/css/js    Settings UI
popup.html/js          Toolbar popup
src/content.js         Scroll engine (injected)
src/background.js      Service worker
src/defaults.js        Defaults & profiles
icons/                 Extension icons
```

## License

MIT © 2026 Nguyễn Xuân Kiên

## Disclaimer

“SmoothScroll” is a trademark of its respective owners. This project is an independent free implementation and is not affiliated with smoothscroll.net.
