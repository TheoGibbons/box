# Box

Hundreds of 3D objects in a shallow box that sits *behind* your screen, like looking through a window. Tilt the phone a little and the inside shifts with real parallax while the opening stays glued to the bezel. You can also tilt, shake and poke the objects. On a phone, the box follows the device's motion sensors, like the [Box3D live-wallpaper demo on r/Simulated](https://www.reddit.com/r/Simulated/comments/1x23ua5/rigid_body_sim_on_mobile_with_box3d/).

It's built with TypeScript, [Three.js](https://threejs.org/) for rendering, [Rapier](https://rapier.rs/) (WASM) for physics and Vite. There's no backend.

## Use it

[Use It](https://theogibbons.github.io/box/)

## Running it

```sh
npm install
npm run dev          # http://localhost:5173, also exposed on your LAN
npm run dev:https    # same over a self-signed cert, which phones need for motion sensors
npm test             # unit and physics integration tests
npm run build        # static site in dist/, deploy anywhere (relative paths)
```

To try it on a phone, run `npm run dev:https`, open the `https://<your-ip>:5173` URL it prints and accept the certificate warning. On iPhone, tap the phone button to grant motion access. Android starts using motion automatically.

## Controls

| | Desktop | Phone |
|---|---|---|
| Look into the box | move the mouse (your "head") | turn the phone slightly |
| Tilt the box | drag, or arrow keys | tilt the phone (or drag if motion is off) |
| Blast | click | tap |
| Stir | Shift-drag or right-drag | drag while motion is on, or a second finger |
| Shake | <kbd>Space</kbd> or the red button | physically shake, or the red button |
| Pause / respawn / level | <kbd>P</kbd> / <kbd>R</kbd> / <kbd>L</kbd> | toolbar |
| Motion · fullscreen · hide UI · settings | <kbd>M</kbd> · <kbd>F</kbd> · <kbd>H</kbd> · <kbd>S</kbd> | toolbar |

## Settings

The settings are saved to localStorage:

- **Objects:** count (100–900), shape (mixed, cubes, balls, pills or pucks), size.
- **View:** box depth in inches (default 1"), parallax strength (1× is physically accurate; the default is 1.5×).
- **Look:** 8 palettes, material presets (plastic, glossy, matte, metal, rubber), roughness, metalness, clearcoat, plain or checkerboard walls, and box colour.
- **Lighting:** key light, environment reflections, shadows, light-follows-tilt, parallax.
- **Physics:** gravity, bounciness, friction, and a boost for how strongly shakes from the motion sensor come through.
- **Device:** quality (auto, low, medium or high), invert motion, keep screen awake, stats overlay.

On **Auto** quality, the app starts at High on desktop and Medium on phones. It steps down when the frame rate stays under 45 fps.

## How it works

- `src/physics.ts` sets up the Rapier world. It has six thick static walls (the front one is the invisible "glass"), and each object is its own dynamic body. The world steps at a fixed 60 Hz and the renderer interpolates between steps, so motion stays smooth at any refresh rate. Resting bodies sleep, and get woken when gravity changes. New objects are placed only where they don't overlap anything; any that don't fit yet are queued and pour in as space frees up.
- `src/viewpoint.ts` estimates where your eye is relative to the screen. On phones, it integrates the gyroscope and slowly re-centres, like iOS parallax wallpapers, so only movement shows parallax. Phones without a gyroscope fall back to gravity, and desktop uses the mouse. The renderer then builds an off-axis frustum from the eye through the screen's edges, which makes the screen behave like a window. Physical sizes use an estimated 150 CSS px per inch on phones and 96 on desktop, with a viewing distance of 12" or 24".
- `src/renderer.ts` draws one `InstancedMesh` per shape, all sharing a single `MeshPhysicalMaterial` with per-instance colours. A shadow-casting key light stays fixed in the "real world", so it swings around as you tilt the box. Room-environment reflections come from PMREM.
- `src/motion.ts` treats `-accelerationIncludingGravity` as the effective gravity felt inside a box held by the phone, which covers both tilt and shakes. It also rotates readings for landscape screens, and checks the reading's sign against `DeviceOrientationEvent` because some browsers have historically reported it inverted.
- `src/math.ts` holds the pure maths (frames, drag-to-tilt, box sizing). Like the settings validation, it's covered by the tests in `tests/`.

## Deploying

**GitHub Pages:** `.github/workflows/deploy.yml` runs the tests and the build, then publishes `dist/` on every push to `main`. In the repo, set **Settings → Pages → Source** to **GitHub Actions** once. The site then appears at `https://<user>.github.io/<repo>/`.

`npm run build` writes a static site to `dist/` with relative asset paths, so it works from any host or subpath (GitHub Pages, Netlify, S3…). Motion sensors need **HTTPS**. The build includes a web app manifest and a small service worker, so the app can be installed to the home screen and works offline.
