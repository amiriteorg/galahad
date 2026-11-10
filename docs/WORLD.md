# The SANDBOX: Galahad's world

An infinite synthetic world where you watch Galahad work. He walks between the places of his keep as he thinks an answer through, reads memory, searches the web, reads the bank, calls your services or runs code at the forge. Every experiment he runs (a robot arm in MuJoCo, an aircraft in JSBSim, a rocket in RocketPy, anything that can say where its bodies are) stands on its own plot of land, live.

It's a view of what's happening now, not a record: the ledger, your chats and kept artifacts are the records.

## Watching it

| Where | How |
|---|---|
| The app | **SANDBOX** (`G` then `X`): the world in 3D; follow Galahad or roam; open an experiment for its readouts |
| A terminal | `galahad world` (where he is, the weather, the experiments); `galahad world --follow` keeps watching |

The stream is yours alone: agents can't watch it, because it carries a line of what Galahad is saying in your chats now and then. Once he has read the bank in an answer, nothing more from that answer appears.

## Where Galahad goes

| Station | When |
|---|---|
| Council table | Thinking an answer through (and a quest's planner and reviewer) |
| Library | Recalling and remembering; reading kept work |
| Watchtower | Searching the web |
| Treasury | Reading the bank |
| Messenger's post | Calling your services (connectors) |
| Forge | Sandboxes: running code |
| Oracle | Decisions |
| Observatory | Investigations and trials |
| The field | Out on an experiment's plot, watching it run |
| The keep | Everything else, and resting |

Agents connected over MCP move him too: their calls are his tools. With nothing to do for half a minute he walks home.

## The weather

The world has Denmark's weather, now: the node asks Open-Meteo for DMI's own forecast model (HARMONIE) at Copenhagen and sends it down the stream as a `weather` event (cloud, rain or snow in mm an hour, visibility, wind, temperature, humidity). Clear, cloudy, overcast, mist, drizzle, rain, snow and thunder are what the world can show; weather it doesn't know is shown as unknown.

- **One fixed request, nothing about you in it.** The same address every time (Copenhagen's coordinates, no key, no cookies, only an `accept` header), redirects refused, the answer checked before it's used (`packages/node/src/weather.ts`).
- **Only while someone watches.** It asks when the world is opened and then at most every 15 minutes while anyone has it open (5 minutes after a failure); with nobody watching, it doesn't ask at all. Weather older than three hours isn't shown.
- **Off switch.** `GALAHAD_WEATHER=off` in the node's environment, and it never asks; the world then shows whatever the HUD is set to.

In the app, the HUD's **Live** (the default) shows it: cloud cover as the cloud, rain from the mm an hour (drizzle light, 8 mm an hour or more a downpour), mist from the visibility (fog under 1 km, haze to 10 km), at least overcast whenever it rains; thunder is a black sky and heavy rain; snow isn't drawn yet and shows as a grey, misty sky (`live-weather.ts`). The clock adds it ("18:05 in Denmark · overcast, 7 °C"). Clear, Mist and Rain override it; while the weather isn't known (or is turned off), Live is clear.

## The robots

The little machines about the keep are real open-source robots, built from their own robot descriptions, with the same parts, proportions and colours, and moved by inverse kinematics on their real joints. All are drawn 2.5 × life size so they read beside the 2.5 m knight.

| Robot | Where | What it does |
|---|---|---|
| Open Duck Mini v2 ([apirrone/Open_Duck_Mini](https://github.com/apirrone/Open_Duck_Mini)), the Microducks | On the lawns round the keep | Walks with a gait on its 10 leg joints (each foot's path solved into hip, knee and ankle angles), sways and bobs; looks about, pecks, hops; looks up at Galahad when he's close; tags along behind him or the dog |
| SO-101 ([TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)), two of them | The lab's workbench | Pick-and-place with small cubes while Galahad works at the lab (IK to each cube, gripper down), the second mirroring the first as leader and follower |
| Reachy Mini ([pollen-robotics/reachy_mini](https://github.com/pollen-robotics/reachy_mini)) | The council table | Turns body and head to watch Galahad while he's at the table; looks about otherwise. Its Stewart-platform neck is drawn as yaw, pitch and roll about the head's centre |

`bun scripts/robots/build.ts` fetches each robot's URDF and meshes at a pinned commit, merges rigidly fixed links, simplifies the meshes to a budget (Open Duck 25 000 triangles, SO-101 15 000, Reachy Mini 30 000) and writes a manifest and a binary per robot (each under 300 KB) into `apps/web/src/world/assets/robots/`, with `NOTICE.txt` and the Apache-2.0 licence. The files are committed, so builds never fetch. The node serves them at `/world-assets/robots/`, cached for good (their URLs carry their content's version). The world fetches them after its first frame; until they arrive, or if they can't, it draws simple stand-ins, so it never breaks. Hover a robot for its name.

## How it's drawn

Low-poly and pastel, every shape procedural (`apps/web/src/world/`). three.js on WebGPU, or WebGL2 where WebGPU isn't there.

| | |
|---|---|
| Galahad | A knightly cyborg: cream panels, orange accents, dark joints, a helm with a black visor, a glowing visor line and amber eyes, a crest, pauldrons, a short tabard, the lodestar glowing on his chest, a backpack with vents. Pistons slide at his knees and elbows, his fingers are jointed, his seams glow. One skinned mesh (`knight.ts`, `rig.ts`). His feet are planted where they land (two-bone IK from the hips, `ik.ts`), his hands reach for the hilt, the bench or his chin, his head turns to his work, and idle, walk, run, work, think and guard blend. He draws his sword at the lab, where its tip is his tool at the bench, and out at an experiment, where he stands guard |
| His dog | The same rig: four IK legs that trot in diagonal pairs and never slide, hind legs folding when it sits (`dog.ts`) |
| The picture | AgX tone mapping, its exposure set by the sun and the weather; colours blended in linear light; a sun with a lavender-and-green hemisphere fill; ambient occlusion baked into the vertex colours; a haze that warms towards the sun, dithered so it never bands; multisampling on medium and high tiers and on phones; a reversed depth buffer on WebGPU (`scene.ts`, `daynight.ts`) |
| The sun and the time | "Now" is the real instant, whatever zone the viewer's device is in: the sun stands where it really is over Copenhagen (55.676° N, 12.568° E, NOAA's solar-position equations), and the moon too, in its real phase (its sphere is lit by the true direction of the sun). The look follows the sun's height and whether it's climbing or sinking, not the hour: a low sun gives golden, peach and lavender light; below the horizon come civil and nautical twilight, then deep blue night. So winter days are short and a December noon (the sun at 11°) is one long, soft golden hour, and midsummer nights stay in blue twilight. Lamps come on as the sun gets low. The HUD shows the time in Denmark ("14:32 in Denmark"); Dawn, Day, Golden hour and Night are fixed places of the sun that override it (`sun.ts`, `daynight.ts`) |
| Fog and mist | Over the haze, a mist that thins with height above the water, summed along the line of sight in closed form, so it lies in hollows and over lakes, in slow drifting banks. It's thickest at dawn and after rain, a little at night, next to none by day; the sky gets a pale band of it along the horizon. All in the fog node, dithered: no extra passes, no transparent cards (`scene.ts`, `sky.ts`) |
| Weather | Clear, overcast, mist, drizzle or rain, eased into, never jumped to: clouds gather before the rain and clear after it, the ground gets wet while it rains and dries over a few minutes, and steams with mist after. Cloud greys the sky (a soft deck of it hides the sun), lowers the exposure and softens the sun and its shadows. Rain falls as thin streaks round the camera, placed and moved on the GPU from their instance number (no buffers, no per-frame uploads; the count by tier); it rings the water and the puddles that gather on the paths and plazas; wet ground, rock, bark and roofs go darker and take a sheen of the sky, through one shared `wetness` uniform that the materials read (`weather.ts`, `rain.ts`, `wet.ts`). The HUD offers Live (Denmark's weather now: see "The weather" above), Clear, Mist and Rain; the choice is kept in this browser. The state takes a kind, or cloud, rain and mist of its own (the real weather). Under reduced motion the drops hang still and faint, and neither the mist nor the clouds drift |
| Light (high tier) | WebGPU has no hardware ray tracing, so the high tier finishes the picture through three's render pipeline instead: ground-truth ambient occlusion (GTAO, at 0.4 resolution) in creases and contacts, sun shafts through trees, mist and rain (the sky round the sun blurred towards it, at 0.4 resolution), and a soft bloom on lamps, glows and the sun. The scene pass keeps the multisampling. Phones (medium) and the WebGL2 fallback draw straight to the screen, as before; low has none (`post.ts`) |
| The land | Trees with faceted trunks and layered lime canopies (a simpler model far off), pinkish boulders, and near the camera grass, daisies, lupines, lavender, clover and pebbles. Every tree, bush and rock casts a soft contact shadow. Streams come down from the hills in pools and waterfalls. The water waves, faceted, with foam where it laps the shore (`vegetation.ts`, `land.ts`, `terrain.ts`) |
| The distance | Three hazy lavender mountain ranges, drifting low-poly clouds, and wind turbines and research domes at the horizon (`scenery.ts`, `sky.ts`) |
| At night | Lit windows, lanterns, screens and runes glow warm or cool (`glows.ts`), and a few point lights by tier. Moonlight is brighter when the moon is full; with it down, the sky's glow still lights the night enough to read |
| The camera | Close and low over his shoulder, so he's large in the frame. While he walks it swings slowly round behind him, and never stands inside a building. Whatever would hide him dissolves in a fine dither (`camera.ts`, `occlusion.ts`) |
| Steadiness | Land and plants grow within a few milliseconds a frame, nearest first. Plant instances live in pages, so a chunk uploads only its own and turning the view uploads nothing. Shaders compile before the first frame, through the post pipeline too (every material again for its render target). Frames are paced to the display, shadows snap to texels, and labels ease onto device pixels after the camera moves |

Each tier (`tiers.ts`) caps every count and effect; to hold the frame time the resolution governor first sheds the high tier's post effects (ambient occlusion, then sun shafts, then bloom), then lowers the pixel ratio, then drops shadows, then grass. A lower pixel ratio that doesn't make frames faster is put back at once (a blurrier picture that buys nothing), and phones never go below 1. Frames that grow land aren't judged.

## Running an experiment

In a sandbox with a network (`gateway` or `online`), Python's `galahad_world` module streams to the node through the sandbox's gateway. Use the Lab (`lab: true`) for the simulators.

```sh
python3 -m galahad_world arm      # a two-link arm (MuJoCo) tracking a circle
python3 -m galahad_world plane    # a Cessna 172 (JSBSim) flying circuits at 600 m
python3 -m galahad_world rocket   # a 1.5 kN rocket (RocketPy) to apogee and down
python3 -m galahad_world gazebo   # balls and blocks down a ramp beside a double pendulum (in the Gazebo image)
```

Your own:

```python
import galahad_world as gw

# Any Gazebo world (in the Gazebo image: gazebo: true): its inline models' visuals become bodies.
gw.gazebo_run("my_world.sdf", seconds=30)

# Any MuJoCo model: every visible geom becomes a body of the world.
gw.mujoco_run(model, seconds=20, control=my_controller, metrics=lambda m, d: {"error_mm": ...})

# Any RocketPy Flight; any JSBSim aircraft (an autopilot holds altitude and flies circuits, or pass control=).
gw.rocketpy_play(flight, title="Mk II", speed=2)
gw.jsbsim_fly("c172x", seconds=300, bank_deg=25)

# Or pose bodies yourself.
with gw.experiment("Pendulum", scene=[gw.box("base", 0.4, 0.4, 0.1, fixed=True), gw.sphere("bob", 0.1, trail=True)], extent=2) as ex:
    for t, x, z in steps:
        ex.frame(t, {"bob": (x, 0, z, 1, 0, 0, 0)}, metrics={"energy_j": e})
```

Metres, z up (x east, y north); orientations as unit quaternions (w, x, y, z). Moving bodies get a pose in every frame; fixed ones (a ground, a ramp) in the first frame only. Frames are paced to `speed` × real time (default 1) so the motion plays as it happened. An experiment ends when its block does: done, or failed with the exception. One that stops sending frames for 90 seconds ends as failed.

| Engine | |
|---|---|
| MuJoCo 3.17 | ✅ in the Lab: `mujoco_run`, `mujoco_scene`, `mujoco_poses` |
| JSBSim 1.3.3 | ✅ in the Lab: `jsbsim_fly` (any JSBSim aircraft) |
| RocketPy 1.13 | ✅ in the Lab: `rocketpy_play` |
| Gazebo Harmonic (gz-sim 8.15) | ✅ in its own image (`gazebo: true`, `galahad sandbox run --gazebo`): headless, DART physics; `gazebo_run`, `gazebo_scene`. Boxes, spheres, cylinders, capsules and planes are drawn; meshes and `<include>`d models aren't yet |
| Isaac Sim | Later: it needs a node with an NVIDIA RTX GPU; the protocol below is what its bridge will speak |
| Anything else | `gw.experiment(...)`: send poses from any simulator, or call the protocol directly |

## The protocol

From a sandbox, through its gateway (`$GALAHAD_WORLD`, the token in `$GALAHAD_TOKEN`):

| Request | Body | Answer |
|---|---|---|
| `POST /world/experiments` with `Authorization: Bearer $GALAHAD_TOKEN` | `{title, engine, scene: [bodies], extent?, plot?: small\|medium\|large}` | `{id, key, plot, scale}` |
| `POST /world/experiments/<id>/frames` with `x-experiment-key: <key>` | `{frames: [{t, poses: {body: [x,y,z,qw,qx,qy,qz]}, metrics?}]}` (≤ 120 per request) | `{accepted}` |
| `POST /world/experiments/<id>/end` with `x-experiment-key: <key>` | `{status: done\|failed, summary?, metrics?}` | the experiment |

A body is `{id, shape, color?, fixed?, label?, trail?}`; shapes are box, sphere, capsule, cylinder, plane, mesh (≤ 20 000 vertices), aircraft and rocket (drawn by the world). The contract, with every check, is `packages/core/src/world.ts`.

## Guarantees and limits

- **Contained.** Starting an experiment needs the sandbox's own gateway token with the `world` scope (every sandbox with a network has it); its frames need the experiment's key, compared in constant time. Frames don't spend the token's budget for models.
- **Checked.** Every scene and frame is validated: known shapes, sizes in range, finite numbers, ids of letters and digits; at most 500 bodies, 60 frames a second per experiment (more are dropped, never queued), 4 MB per request.
- **Laid out.** Plots sit on a spiral grid of 110 m cells around the keep; they never overlap it or each other. An experiment far bigger than its plot (a flight, a rocket) is scaled down to fit (`scale`).
- **Kept briefly.** The world is in the node's memory: every running experiment and the 12 that ended most recently. A restart starts it fresh.
- **One node's world.** The app shows the world of the node it talks to; experiments on another node show in that node's world.
