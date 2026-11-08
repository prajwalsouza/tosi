# Visualization (experimental)

Spatial views of Tosi's reports: on a phone looking at the real sky, and in a headset under a virtual one. Experimental: these views show results, they never produce them.

## What matters to someone standing there

1. **What is in my sky right now, and does it matter?** Live satellites overhead, with the filings Tosi flagged stand out in orange. Each is labelled with what the report says: how far over the limit it would arrive here, and why. Everything else is faint grey.
2. **What is coming next?** A time dial. Palm forward and it appears; roll the wrist to turn it. It snaps to the next moment that matters, not through continuous time:
   - **Live time:** the next pass of a satellite connected to a flagged filing.
   - **Report time:** the next issue of filings, with its new claims appearing in the sky.

3. **Who would be hit, around me?** The country's listed stations sit on the horizon at their true bearing, labelled with distance, class and band; far ones low and small, near ones larger. Only stations sharing a band with a flagged filing light up. A high-gain dish draws its pointing direction as a faint line, and if that line runs to a flagged satellite, the link glows. Above each lit station, a bar shows the power arriving there against its limit.
4. **Why distance matters.** Select a satellite and its signal leaves it as a widening cone. Rings mark distance; at each one the power density has fallen with the square of the distance, 6 dB for every doubling. The numbers add up as in the report: power, plus antenna gain, minus spreading, gives what arrives. Grab the satellite and pull it closer or push it away, and the arriving power changes live. A geostationary satellite at 36,000 km and a low one at 550 km are about 36 dB apart, and it shows.
   - **On the ground (terrestrial):** a transmitter across the border spreads its field over the land. It falls off faster than the plain square law, because the propagation model accounts for the Earth and the path, and the view says so.

**Filings are not satellites.** A filing is a planned network: an orbital slot, or an inclination and altitude, not a position at a given moment. Live positions come from public orbital data for real satellites. Linking a live satellite to a filing is matched by name and orbit and is shown as approximate. Geostationary filings sit at fixed positions and need no matching.

## Two apps

| | WebXR app | Native Quest app |
|---|---|---|
| Runs on | Android phones (AR, real sky); Quest browser (VR, virtual sky); desktop browser | Quest 2 and later (VR, virtual sky) |
| Built with | TypeScript, three.js, WebXR | Godot with Rust bindings (Unity is the fallback if hand tracking demands it) |
| Engine | TypeScript, or Rust compiled to WebAssembly | Rust, native |
| Input | Touch, or hand tracking in the Quest browser | Hand tracking |

## Constraints

- **The Quest stays indoors.** Sunlight through the lenses can damage the displays, and tracking struggles outside. On the Quest the sky is virtual: pick a place and stand under it. The phone is for the real sky.
- **Quest 2 passthrough is grey and low resolution, and its cameras are not open to developers** (camera access arrived with Quest 3). Mixed reality on Quest 2 is out of scope.
- **iPhones have no WebXR AR in Safari.** Real-sky AR on iPhone would need a native ARKit app later.

## Positioning on the phone

- **Where:** GPS.
- **Up:** ARKit and ARCore track gravity reliably; the horizon comes from geometry, not from the image.
- **North:** the hard part; phone compasses are often off by 5 to 15 degrees. In order of preference:
  1. ARCore Geospatial API (native), accurate to a few degrees where street imagery exists.
  2. Sun or Moon alignment: point at it once; its position is known, so heading is calculated, not guessed.
  3. ARKit gravity-and-heading alignment on iOS, as accurate as the compass.
- **Sky only:** ARCore's Scene Semantics labels sky pixels outdoors on Android, so satellites behind buildings and trees can be dimmed. No equivalent is built into iOS; there, draw over everything at first.

## Build order

1. Virtual sky in a desktop browser: place, geostationary arc, horizon, live satellites, flagged filings, time dial on keyboard and mouse.
2. The same in the Quest browser via WebXR, with hand tracking for the dial.
3. Phone AR on Android with Sun calibration.
4. The native Quest app, running the Rust engine.

## Later ideas

The globe from outside with a filing's beam reaching the ground; the spectrum as a landscape; issues over time as a waterfall; terrestrial field strength over the border.
