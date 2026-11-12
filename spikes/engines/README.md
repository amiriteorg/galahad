# Engine spikes

The same small slice of a generated world in three engines, to answer one question with numbers: would a real game engine make the SANDBOX more scalable? The answer, the threshold it was held to and the numbers are in `docs/WORLD.md` ("Would a game engine carry more?").

**Nothing in Galahad imports this directory**, the node never bundles it, and its dependencies (`package.json`, `bun.lock` here) are not Galahad's.

## The slice

`content.js` makes it from a seed, the same numbers for every engine, shaped like what the SANDBOX draws:

| | at `x=1` | |
|---|---|---|
| Land | 25 chunks of 64 m, 1,152 faceted triangles each, a colour a face | one mesh a chunk |
| Plants | 24 kinds, 500 of each, about 96 triangles | one instanced mesh a kind (a matrix and a tint an instance), swaying in the vertex shader; half the kinds cast a shadow |
| Animals | 8 kinds, 50 of each, 72 triangles | one instanced mesh a kind; every instance written on the CPU every frame (they walk), legs swung in the vertex shader; all cast a shadow |
| A figure | 23 bones, about 1,100 triangles | one skinned mesh, its bones turned every frame, with a shadow |
| Light | a sun with a 2048² PCF shadow map, a sky light, exponential fog | |

`?x=2` and `?x=3` ask for two and three times the chunks and kinds (so the draw calls grow, as they do in the SANDBOX): about 75, 130 and 180 draw calls a frame with the shadow pass.

| File | |
|---|---|
| `three.js` | three.js 0.187, `WebGPURenderer`, node materials (TSL), `InstancedMesh`, as the SANDBOX is built. `?mode=bundle`: the land and the plants in a `BundleGroup` (WebGPU render bundles). `?webgl=1`: its WebGL2 backend |
| `babylon.js` | Babylon.js 9.36, `WebGPUEngine` (or `Engine` with `?webgl=1`), `StandardMaterial` with a material plugin for the sway (WGSL and GLSL), thin instances, `ShadowGenerator`, `Skeleton`. `?mode=snapshot` and `?mode=snapshot-fast`: snapshot rendering |
| `playcanvas.js` | PlayCanvas engine 2.24, `StandardMaterial` with its transform chunk overridden for the sway (WGSL and GLSL), hardware instancing, a `Skin` |
| `harness.js` | The loop and the clock they're all measured with (the main thread's time a frame; the frame's interval with the browser's frame-rate limit off) |
| `measure.ts` | Bundles each (minified), serves them on the loopback, runs them in headless Edge round after round, writes `results.json` |

Where they aren't alike, for want of the same thing in the engine: PlayCanvas has no hemisphere light (a flat ambient colour stands in), its default instancing format has no colour an instance, and its sun's shadow follows the view out to a distance instead of covering a fixed box; Babylon's shadow pass doesn't run the sway (its depth shader isn't the material's); only three.js gives each instance its own phase (from the instance's index).

## Running it

```sh
cd spikes/engines
bun install
bun measure.ts                       # every engine and mode, x = 1, 2, 3, three rounds
bun measure.ts --only='^three' --x=1 --rounds=1 --shots=/tmp/shots
```

It needs Microsoft Edge (`EDGE=<path>` to say where). The machine it was measured on, what it found, and how far that can be trusted are with the results in `docs/WORLD.md`; `results.json` is the last run's.
