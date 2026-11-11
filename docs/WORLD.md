# The SANDBOX: Galahad's world

An infinite synthetic world where you watch Galahad work. He walks between the places of his keep as he thinks an answer through, reads memory, searches the web, reads the bank, calls your services or runs code at the forge. Every experiment he runs (a robot arm in MuJoCo, an aircraft in JSBSim, a rocket in RocketPy, anything that can say where its bodies are) stands on its own plot of land, live.

It's a view of what's happening now, not a record: the ledger, your chats and kept artifacts are the records.

## Watching it

| Where | How |
|---|---|
| The app | **SANDBOX** (`G` then `X`): the world in 3D; follow Galahad or roam; open an experiment for its readouts. **Go to** lists the two test sites, the stations and the experiments; the **map** in the corner (`M`) shows them all, with Galahad and where the view looks, and a tap on it takes the view there; the **sky** button says the time and the weather in Denmark and opens the choices for previewing another |
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

## The test sites

Beyond the keep there are two places built for testing, and experiments run there when they fit.

| Site | Where | What runs there |
|---|---|---|
| The proving ground | On the heights west of the keep, 5 m above it, looking down on the keep and the lake: a north-south runway, a taxiway and an apron, a launch pad, a rover course | Aircraft (JSBSim) over the runway; rockets (RocketPy) from the launch pad; anything that asks for the field (`site: "field"`) on the course |
| The workshop | East of the keep, at the end of a level road, by the lake's arm: a hall with a wide door facing the keep, an aisle and four test cells | Anything that spans less than a test cell (10 m: an arm, a gripper, a small rig) at full size; anything that asks for the hall (`site: "hall"`), scaled to fit |

Everything else, and whatever finds its site's pads in use, stands on its own plot of open land (`site: "open"` asks for that). An ended experiment stays on its pad, dimmed, until the next one needs it; then it's cleared away (a `cleared` event). Galahad walks out to each: up the hillside to the proving ground, and into the hall by its door and along its aisle, never through a wall. The sites' places are fixed in the contract (`SITES` and `PADS` in `packages/core/src/world.ts`), so the node and every renderer agree; their plans (walls, door, runway, paving) are `hall-plan.ts` and `field-plan.ts`.

## The weather

The world has Denmark's weather, now: the node asks Open-Meteo for DMI's own forecast model (HARMONIE) at Copenhagen and sends it down the stream as a `weather` event (cloud, rain or snow in mm an hour, visibility, wind, temperature, humidity). Clear, cloudy, overcast, mist, drizzle, rain, snow and thunder are what the world can show; weather it doesn't know is shown as unknown.

- **One fixed request, nothing about you in it.** The same address every time (Copenhagen's coordinates, no key, no cookies, only an `accept` header), redirects refused, the answer checked before it's used (`packages/node/src/weather.ts`).
- **Only while someone watches.** It asks when the world is opened and then at most every 15 minutes while anyone has it open (5 minutes after a failure); with nobody watching, it doesn't ask at all. Weather older than three hours isn't shown.
- **Off switch.** `GALAHAD_WEATHER=off` in the node's environment, and it never asks; the world then shows whatever the HUD is set to.

In the app, the HUD's **Live** (the default) shows it: cloud cover as the cloud, rain from the mm an hour (drizzle light, 8 mm an hour or more a downpour), snow likewise (flurries light, 4 mm an hour of water or more heavy), mist from the visibility (fog under 1 km, haze to 10 km), the wind at its real speed (it leans the rain, carries the snow, moves the clouds and bends what grows; its bearing isn't reported, so it blows from the west-south-west, as it mostly does in Denmark), at least overcast whenever it rains or snows; thunder is a slate sky, heavy rain and lightning (`live-weather.ts`). The clock adds it ("18:05 in Denmark · overcast, 7 °C"). Clear, Mist, Rain, Snow and Storm override it; while the weather isn't known (or is turned off), Live is clear.

## The robots

The little machines about the keep are real open-source robots, built from their own robot descriptions, with the same parts, proportions and colours, and moved by inverse kinematics on their real joints. All are drawn 2.5 × life size so they read beside the 2.5 m knight.

| Robot | Where | What it does |
|---|---|---|
| Open Duck Mini v2 ([apirrone/Open_Duck_Mini](https://github.com/apirrone/Open_Duck_Mini)), the Microducks | On the lawns round the keep | Walks with a gait on its 10 leg joints (each foot's path solved into hip, knee and ankle angles), sways and bobs; looks about, pecks, hops; looks up at Galahad when he's close; tags along behind him or the dog |
| SO-101 ([TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)), two of them | The lab's workbench | Pick-and-place with small cubes while Galahad works at the lab (IK to each cube, gripper down), the second mirroring the first as leader and follower |
| Reachy Mini ([pollen-robotics/reachy_mini](https://github.com/pollen-robotics/reachy_mini)) | The council table | Turns body and head to watch Galahad while he's at the table; looks about otherwise. Its Stewart-platform neck is drawn as yaw, pitch and roll about the head's centre |

`bun scripts/robots/build.ts` fetches each robot's URDF and meshes at a pinned commit, merges rigidly fixed links, simplifies the meshes to a budget (Open Duck 25 000 triangles, SO-101 15 000, Reachy Mini 30 000) and writes a manifest and a binary per robot (each under 300 KB) into `apps/web/src/world/assets/robots/`, with `NOTICE.txt` and the Apache-2.0 licence. The files are committed, so builds never fetch. The node serves them at `/world-assets/robots/`, cached for good (their URLs carry their content's version). The world fetches them after its first frame; until they arrive, or if they can't, it draws simple stand-ins, so it never breaks. Hover a robot for its name.

## How it's drawn

Low-poly and pastel, every shape procedural (`apps/web/src/world/`). three.js on WebGPU, or WebGL2 where WebGPU isn't there. The facets are small where you look closely and large far off: more, smaller facets near the camera, never smooth.

| | |
|---|---|
| Galahad | A knightly cyborg: cream panels, orange accents, dark joints, a helm with a black visor, a glowing visor line and amber eyes, a crest, pauldrons, a short tabard, the lodestar glowing on his chest, a backpack with vents. Up close he's a machine you could take apart: bevelled plates, seams, rivets, finely segmented joints, hoses up his back and clipped cables. Pistons slide at his knees and elbows, his fingers are jointed, his seams glow. One skinned mesh (`knight.ts`, `rig.ts`). His feet are planted where they land (two-bone IK from the hips, `ik.ts`), his hands reach for the hilt, the bench or his chin, his head turns to his work, and idle, walk, run, work, think and guard blend. He draws his sword at the lab, where its tip is his tool at the bench, and out at an experiment, where he stands guard |
| His dog | Bevelled cream plates with seams and bolts, orange panels, one big ringed camera-lens eye. The same rig: four IK legs that trot in diagonal pairs and never slide, hind legs folding when it sits (`dog.ts`) |
| The picture | AgX tone mapping, its exposure set by the sun and the weather; colours blended in linear light; a sun with a lavender-and-green hemisphere fill; ambient occlusion baked into the vertex colours; an air whose colour depends on the way you look, dithered so it never bands; multisampling on medium and high tiers and on phones; a reversed depth buffer on WebGPU (`scene.ts`, `daynight.ts`, `air.ts`) |
| The sun and the time | "Now" is the real instant, whatever zone the viewer's device is in: the sun stands where it really is over Copenhagen (55.676° N, 12.568° E, NOAA's solar-position equations), and the moon too, in its real phase (its sphere is lit by the true direction of the sun). The look follows the sun's height and whether it's climbing or sinking, not the hour: a low sun gives golden, peach and lavender light; below the horizon come civil and nautical twilight, then deep blue night. So winter days are short and a December noon (the sun at 11°) is one long, soft golden hour, and midsummer nights stay in blue twilight. Lamps come on as the sun gets low. The HUD shows the time in Denmark ("14:32 in Denmark"); Dawn, Day, Golden hour and Night are fixed places of the sun that override it (`sun.ts`, `daynight.ts`) |
| The sky | One dome, drawn last and only where sky shows (so its shader costs the pixels of sky, not the screen). From the air at the horizon to the zenith; the sun a crisp disc in a corona, reddening as it sinks; clouds with crisp edges that gather into a deck as the cover grows, lit at their rims by the day, from below by a sun at the horizon, from inside by lightning; curtains of rain hanging under them far off. From dusk the stars come out (they twinkle; cloud hides them), and the moon shows whenever it's up: the camera sees only the lowest ten degrees of sky, so the moon's height is squeezed into that strip (it rises as it does, clears the far hills quickly, and never climbs out of view), at its real bearing and in its real phase (`sky.ts`, `daynight.ts`) |
| The air | Haze, thicker far off and low down, warm and glowing towards the sun (the moon, deep in the night) and cooler away from it; where broken cloud or mist breaks the sun, rays fan from it across the sky and the haze. The same colour is the sky's horizon, so the land melts into it whichever way the light falls. On days of broken cloud, soft cloud shadows drift over the land with the wind. All of it is uniform maths in the scene's one fog node: no passes, no transparent cards, next to nothing for a phone (`air.ts`, `atmosphere.ts`) |
| Fog and mist | Over the haze, a mist that thins with height above the water, summed along the line of sight in closed form, so it lies in hollows and over lakes; and, while the sun is low and at night, a thin sheet of it on the ground where you stand. Both drift in slow banks, read at the point looked at and halfway to it, so the banks slide over the land as you move. Mist glows towards the light. It's thickest at dawn and after rain, a little at night, next to none by day; the sky gets a pale band of it along the horizon. All in the fog node (`atmosphere.ts`, `sky.ts`) |
| Weather | Clear, overcast, mist, drizzle, rain, snow or storm, eased into, never jumped to: clouds gather before the rain or the snow and clear after it; the ground gets wet while it rains and dries over a few minutes, and steams with mist after; snow settles while it falls and thaws after (faster in sunshine, fastest in rain), leaving wet ground; the wind rises and falls. Cloud greys the sky, lowers the exposure and softens the sun and its shadows; a storm turns it to slate. Rain and snow are streaks and flakes placed and moved on the GPU from their instance number (no buffers, no per-frame uploads; the count by tier), in three boxes that ride ahead of the camera, near, middle and far, drawn thicker and fainter with distance, so the fall has depth; the wind leans the rain and carries the snow, and flakes flutter. Rain rings the water and the puddles that gather on the paths and plazas; wet ground, rock, bark and roofs go darker and take a sheen of the sky; snow lies white on whatever faces up (ground, roofs, the tops of crowns and rocks), in patches while it's thin: all through the same few hooks the materials read (`weather.ts`, `rain.ts`, `wet.ts`). In a storm lightning strikes every few seconds: a flash that lights the land, the air, the clouds and the rain and is gone in a fraction of a second, two pulses at most (`lightning.ts`). The HUD offers Live (Denmark's weather now: see "The weather" above), Clear, Mist, Rain, Snow and Storm; the choice is kept in this browser. Under reduced motion drops and flakes hang still and faint, nothing drifts, the stars don't twinkle and there is no lightning |
| Light (high tier) | WebGPU has no hardware ray tracing, so the high tier finishes the picture through three's render pipeline instead: ground-truth ambient occlusion (GTAO, at 0.4 resolution) in creases and contacts; shafts of light, marched from the camera through the sun's (or the moon's) shadow map at half resolution, 20 steps a pixel, then blurred across neighbours of like depth, so lit air stands between the trees, under the keep and through its railings wherever the light really falls, in mist and rain (the mist leaves its sunlit share to them); splashes where rain lands on anything that faces up, near the camera; and a soft bloom on lamps, glows, the sun and lightning. The scene pass keeps the multisampling. Phones (medium) and the WebGL2 fallback draw straight to the screen: their light in the air is the glow towards the sun and the rays in the haze; low has the same (`post.ts`, `shafts.ts`) |
| The ground | 64 m chunks on a 4 m grid, and near the camera on a 2 m grid (`terrainFine` metres round the focus, by tier) grown a chunk at a time. The fine grid morphs into the base one in the vertex shader before the edge of its ring, so chunks meet without a crack and swap without a pop; a short skirt under every edge covers a chunk still growing. Small undulations, crags, gentle terraces and crisp stream banks give the fine grid something to show, and each cell is split along its more level diagonal so ledges stay crisp. Faces are coloured by their ground, their slope (bare earth, then rock) and by feet near the paths. Feet, paws and plants stand on the drawn triangles, not on a smoothed height (`terrain.ts`, `land.ts`) |
| What grows | Oaks, pines, round trees, parasols, birches with banded bark and pastel trees in blossom, each in three levels of detail by distance and tier: near, crowns are heaps of many small facets on tapering trunks with root flares and branches (`treeDetail` metres, none on the low tier); farther, a simpler model (`treeLod`); far off, a few facets. Leafy and flowering bushes and ferns; boulders, stones and layered slabs with chipped facets (gathering on crags); near the camera grass in tufts, clumps and seed, daisies, lupines, lavender, buttercups, campions, clover and pebbles. Every tree, bush and rock casts a soft contact shadow. Streams come down from the hills in pools and waterfalls. The water waves, faceted, with foam where it laps the shore (`vegetation.ts`, `land.ts`) |
| The keep | Made the way a carpenter would: decks, floors and tables of planks, a shingled roof, bevelled panels with seams, framed windows with sills, capped railing posts and balusters, a solar roof with cells, the giant tree's crown in heaps of small facets, the lab's limestone hill chipped and layered, its bench a worktop over drawers, stones along the paths (`keep.ts`) |
| The distance | Three hazy lavender mountain ranges, drifting low-poly clouds, and wind turbines and research domes at the horizon; nearer, a research station of panelled geodesic domes and a limestone cliff and arch in chipped layers (`scenery.ts`, `sky.ts`) |
| At night | Lit windows, lanterns, screens and runes glow warm or cool (`glows.ts`), and a few point lights by tier. Moonlight is brighter when the moon is full, and the air glows silver round the moon; with it down, the sky's glow still lights the night enough to read |
| The camera | Close and low over his shoulder, so he's large in the frame. While he walks it swings slowly round behind him, and never stands inside a building. Whatever would hide him dissolves in a fine dither (`camera.ts`, `occlusion.ts`) |
| Steadiness | Land and plants grow within a few milliseconds a frame, nearest first; a chunk's fine grid is grown in two steps (its samples, then its mesh), each within the same budget. Plant instances live in pages, so a chunk uploads only its own and turning the view uploads nothing; bushes and rocks are written once, and only the trees change pages as their level of detail changes. Shaders compile before the first frame, through the post pipeline too (every material again for its render target). Frames are paced to the display, shadows snap to texels, and labels ease onto device pixels after the camera moves |

Each tier (`tiers.ts`) caps every count and effect, and has a triangle budget (`triangles`) the tests hold the land and its plants to at full reach: low 0.5 M, medium 1.05 M, high 1.95 M, each below what it drew before the world got finer (the cheaper small plants pay for the finer ground and trees); to hold the frame time the resolution governor first sheds the high tier's post effects (ambient occlusion, then the light shafts, then bloom), then lowers the pixel ratio, then drops shadows, then grass. A lower pixel ratio that doesn't make frames faster is put back at once (a blurrier picture that buys nothing), and phones never go below 1. Frames that grow land aren't judged.

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

# Say where it stands, if the node's choice isn't yours: a rover on the proving ground's course.
gw.mujoco_run(rover, seconds=60, title="Rover on the course", site="field")

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
| `POST /world/experiments` with `Authorization: Bearer $GALAHAD_TOKEN` | `{title, engine, scene: [bodies], extent?, plot?: small\|medium\|large, site?: field\|hall\|open}` | `{id, key, plot, scale}` |
| `POST /world/experiments/<id>/frames` with `x-experiment-key: <key>` | `{frames: [{t, poses: {body: [x,y,z,qw,qx,qy,qz]}, metrics?}]}` (≤ 120 per request) | `{accepted}` |
| `POST /world/experiments/<id>/end` with `x-experiment-key: <key>` | `{status: done\|failed, summary?, metrics?}` | the experiment |

A body is `{id, shape, color?, fixed?, label?, trail?}`; shapes are box, sphere, capsule, cylinder, plane, mesh (≤ 20 000 vertices), aircraft and rocket (drawn by the world). The contract, with every check, is `packages/core/src/world.ts`.

## Guarantees and limits

- **Contained.** Starting an experiment needs the sandbox's own gateway token with the `world` scope (every sandbox with a network has it); its frames need the experiment's key, compared in constant time. Frames don't spend the token's budget for models.
- **Checked.** Every scene and frame is validated: known shapes, sizes in range, finite numbers, ids of letters and digits; at most 500 bodies, 60 frames a second per experiment (more are dropped, never queued), 4 MB per request.
- **Laid out.** The sites' pads are fixed. Plots on open land sit on a spiral grid of 110 m cells around the keep; they never overlap it, each other or a site (cells that would crowd one are skipped). An experiment far bigger than its plot or pad (a flight, a rocket) is scaled down to fit (`scale`).
- **Kept briefly.** The world is in the node's memory: every running experiment and the 12 that ended most recently. A restart starts it fresh.
- **One node's world.** The app shows the world of the node it talks to; experiments on another node show in that node's world.
