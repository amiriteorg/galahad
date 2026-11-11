# The SANDBOX: Galahad's world

An infinite synthetic world where you watch Galahad work. He walks between the places of his keep as he thinks an answer through, reads memory, searches the web, reads the bank, calls your services or runs code at the forge. Every experiment he runs (a robot arm in MuJoCo, an aircraft in JSBSim, a rocket in RocketPy, anything that can say where its bodies are) is built in the workshop, tested live where it belongs, and examined at the observatory.

The world itself is a view of what's happening now. Its experiments are also a record: each is archived, complete and for good, on the node that ran it, to replay, examine and learn from (see "Saved experiments").

## Watching it

| Where | How |
|---|---|
| The app | **SANDBOX** (`G` then `X`): the world in 3D. **Talk to Galahad** in the composer at its foot (`C`): it's the same conversation as the Chat page, and asking follows him, so you watch him walk off to the library, the watchtower or the treasury to answer. **The selector** at the top (`L`) says what the view is on and lists everything it can look at (Galahad, the chalkboard, the experiments, the two test sites, the stations), searchable; picking an experiment opens its readouts, and picking the chalkboard (or tapping it in the world) opens it to draw on. **Follow Galahad** (`F`) shows when the view isn't on him; the **map** (`M`) shows the world, Galahad and where the view looks, and a tap takes the view there; the **sky** button says the time and the weather in Denmark and opens the choices for previewing another | **The selector** at the top (`L`) says what the view is on and lists everything it can look at (Galahad, the experiments, the saved experiments, the two test sites, the stations), searchable; picking an experiment opens its panel (its readouts; once it has ended, what it showed, charted), picking a saved one replays it.
| A terminal | `galahad world` (where he is, the weather, the experiments and their phases); `galahad world --follow` keeps watching; `galahad experiments` lists the saved ones, `galahad experiments show <id>` examines one |

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
| Observatory | Investigations and trials; examining an experiment that has ended (its write-up goes on the chalkboard: a note in words and a chart of the readout the examination leads with (the one that ran away, else the first the experiment sent, unless it hardly moved), each in place of the last) and reading saved ones; the chalkboard (writing on it, reading it) |
| The field | Out on an experiment's pad or plot, watching it tested |
| The workshop's assembly bench | Building an experiment (its sandbox spinning up, its simulation starting) |
| The keep | Everything else, and resting |

Agents connected over MCP move him too: their calls are his tools, and each agent walks there beside him (see "His partners" below). With nothing to do for half a minute he goes back to his day.

## His heartbeat

His heartbeat (the loop that looks the fleet over every 30 minutes, ARCHITECTURE §9) is in the world, and in him: the lodestar on his chest beats softly all the time, a lub-dub at rest, and harder for a few seconds whenever a heartbeat runs (on any node: the world reads it from the mind). The selector's line for him and his bubble say how it went, "Heartbeat ✓ 12:30" (Denmark's time), or what needs you ("Needs you: rack is offline (+1 more)"), and "fixed one thing himself" when he did (see "Self-action" in ARCHITECTURE §9).

When something needs you (a warning or an alert; information only doesn't take him from his day), and he has no work, he goes to where it is and stays there, concerned (his hand at his chin, looking at it), until it's resolved or you dismiss it:

| Finding | Where he goes |
|---|---|
| A silent node | Its spot in the fleet's ring at the keep, in front of its banner or tower |
| A sandbox problem (one the reaper missed, no disk limit, the image gone) | The forge |
| Low disk | The workshop's racks |
| A failing or orphaned loop, a connector, a standing order | The messenger's post |
| A role with no model | The council table |
| The vault, the fleet, your checklist | The keep |

The stream carries it as a `heartbeat` event (and in `hello`): when its last run finished and how, the open findings by severity with their titles and places, what he fixed himself after it, and whether self-action is on. It's read from the mind (the notices the heartbeat raised, less those dismissed), so every node's world agrees whichever node ran it; the hub looks again every 15 seconds while someone watches, and at once when a run ends or a notice is dismissed. The bank's own findings stay in the Inbox: the world never shows anything about the bank. `galahad world` prints it ("♥ 12:30 ✓ all quiet").

## His day

The SANDBOX is where he does everything: he builds at the workshop's bench, tests on the sites, examines at the observatory, writes on the chalkboard, thinks, walks, sleeps and writes his journal. When there's no work he lives a day, planned from the real time in Denmark and a seed (`packages/core/src/life.ts`, so the node reads the same day the world shows), so he's doing the same thing on every device at the same moment:

| When (Denmark) | What |
|---|---|
| Night, until the dog wakes him (06:15 to 06:45) | Asleep at his hearth: lying back on his bed under his blanket, his sword on its stand, the dog asleep on its cushion against the bed |
| Then, for a few minutes | Woken by the dog: it's up first, tail going; he wakes, pats it from where he lies, gets up and down to it, and they sit by the fire |
| Then | Morning rounds: each station of the keep in turn, a pause and a look at each |
| Then | Out for a walk with the dog: the trail down to the lake, along the shore and back over the meadow, the dog out in front; at each view he stops and looks out, and goes down to it for a pat |
| The day | Visits, 35 to 70 minutes each, in an order of the day's own: his friends the Microducks, reading at the library, the workshop, the proving ground, the council table, the observatory, thinking on the bench by the lake; fetch with the dog at noon |
| 18:30 | A walk with the dog |
| Then | The council table with Reachy Mini, then the board at the observatory |
| From about 20:40 | By the fire with the dog: seated on the log, the dog lying at his side |
| 21:28 | Writing his journal at his desk (the node's nightly reflection runs at 21:30: he's writing as it's written); he stops now and then, hand to his chin, and thinks back over the day |
| Bedtime (21:52 to 22:12) | A last pat for the dog, and asleep |

Real work always comes first: the moment the stream has work for him (a chat, a tool, a quest, an agent's call, an experiment), he drops what he's doing and goes. When it's done, the dog comes first: if he was at it for half a minute or more, the dog bounds to his feet and he crouches and pats it before anything else (not up on the keep's deck, where the dog can't come). Then he picks his day up where it would be (the plan is a function of the time, so it's simply the block for now). What needs you comes next, then the dog's battery, then the plan. Under reduced motion he stays put, resting on the deck. The selector and his bubble say what he's doing ("Out for a walk with the dog · Heartbeat ✓ 12:30"), with the dog's name in it once you've given it one.

### His hearth

South of the keep, down a path from the foot of its stairs, is his own camp (`hearth-plan.ts` has where everything stands, `hearth.ts` draws it): a fire in a ring of stones under a tripod with a kettle (it burns from dusk to morning and whenever he's there, not in a downpour; embers rise from it); his bed, a woven mat with a wedge to lean back on, his feet to the fire, a footlocker at its foot with his blanket folded on it (spread over his legs while he lies there); the dog's cushion tucked against the mat on his right, with its charge post (the cushion is its dock: it sleeps within reach of his hand, charging); a log to sit on by the fire; his desk with a chair, a lantern and his journal lying open (tap it, or pick "His journal" in the selector, to read what he wrote); a stand where his sword rests while he sleeps; and a pole with his pennant and a lantern. A second path leads on to a bench on the lake's shore, looking south over the water, with a lantern on a post.

He sits down where he stands (the seat is just behind him: his hips come down and back, his feet out before him, his hands on his thighs, his scabbard swung forward beside his thigh) and lies back the same way, onto the wedge; asleep his head goes back, his eyes and seams dim to a glimmer (never the lodestar, which beats slower), and he breathes slowly (`knight.ts`). A seat is solid only where he never stands (a chair's back, the log's ends, the desk's far half), and a test walks him to every seat, the bed, the bench and round the whole trail on the real land among the real solids. `?life=sleep` (or wake, hearth, journal, ponder, walk) shows each.

## Those he looks after

`care.ts` is his day beat by beat, and how he looks after everyone in it. It allocates nothing a frame (its plan is asked once a block), and costs about half a microsecond a frame.

| Who | What he does |
|---|---|
| His dog | It's with him through all of it. It watches him: sitting or lying, its head turns to wherever he is. When he settles to something (his work, his journal, the fire, the bench) it lies down by him, forelegs out, within reach of his hand, and he pats it now and then; it wanders off for a sniff far less often than it did, and comes back. On a walk it's out in front, leading. When the work's done it gets its pat before anything else, bouncing on its forelegs as it's greeted. At night it sleeps on its cushion against his bed (head on its paws, its eye a glimmer) after a last pat, and in the morning it's up first and wakes him. He throws a ball it runs for, picks up and brings back to his feet, three throws a game. Its battery is four cells on its back, green to red: it drains as it goes (faster running) and lasts a good half hour of play; its cushion is its dock, so it charges as it sleeps, and when it's low by day he walks it there, sees it settled and pats it, and it lies there until it's full (about two minutes) while he goes on; flat while he works, it goes on its own. Its mood shows: its tail up and wagging when it plays or is patted, low and slow when it's tired; its ears pricked or drooped; the light in its eye dimmed when it's low. Hover it (or pick it in the selector) for its name and battery; you name it in Settings or with `galahad dog name` |
| His friends | The Microducks gather round him in a ring when he visits, heads up at him; he crouches to look one over; one that has wandered far from the others he walks to and leads home (it follows him back). At the council table Reachy Mini and he look at each other and "talk": their heads tilt and nod |
| His companions | On the proving ground: before the aircraft flies he walks round it, a pause at each of six points (it waits at its tie-down, engine off, until he's done; it's never held in the air or on its way); he swaps the quadcopter's battery on its pad once it's down (it's ready to fly a moment later); he checks the rover at its start gate as it comes by. In the workshop he clears a finished print at the printer farm and looks over the assembly line's arms. The machines run their own simulations (`field*.ts`, `hall*.ts`); care only reads them and holds the aircraft for the walk-round |
| His partners | See below |

`?life=walk-dog` (or sleep, wake, rounds, walk, friends, library, workshop, field, council, observatory, ponder, hearth, journal) on the page fixes his day to one part of it, and `?charge=0.15` sets the dog's battery, for tours; with `?trace=1`, `globalThis.__sandboxLife` says what he's doing, how he is (sitting, lying, asleep, writing), whether the dog's lying down and how far it is from him, and whether the fire's lit (and its `force(activity)` and `setCharge(c)` change it).

## His partners

The coding agents that work with him over MCP (Claude Code, OpenCode…) are in the world as small squires: robots in the knights' style, cream plates, an orange tabard, a dark visor with a glowing line; hover one for its name. One appears at the keep's door (small, growing as it comes) when its first call arrives, walks beside him to the station its calls send them to and stands by while they work; when it's made no call for 45 seconds it walks back to the keep and fades away. At most six at once. The hub knows them from the agents' calls (an arm's label is its name; Galahad's own chat and his loops are him, not partners) and streams them as a `partners` event (and in `hello`). All of them are three instanced meshes (body and head, legs, arms), each a small circle among the solids.

The fleet's nodes are his partners too: he tends a silent one's spot (above). The selector's **Partners** group lists the agents with him, then the nodes (online or silent); picking one takes the view there.

## The chalkboard

A chalkboard stands beside the observatory, on the keep's side: a slate in a wooden frame on two legs with splayed feet, a chalk tray along its foot with sticks of chalk in the board's colours and a felt duster. It's the board you share with Galahad (the app's Chalkboard page: G then D), and its face shows what's on it now: his notes, equations and charts, and your drawing, in chalk.

- **He writes there.** When he (or an agent of yours) writes on the board, he walks to it, stands before the spot the item went to and writes, his right hand moving along its lines with the chalk for a few seconds; the item appears on the face as he starts. Several writes queue (three at most; more just appear). Under reduced motion they just appear.
- **You draw there.** Tap the board (or hover it: "Chalkboard · tap to open") or pick it in the selector, and it opens over the world to draw on (full screen on a phone). What you draw shows on the face too.
- **How it's drawn.** Its face is a texture painted from the board's state with the same chalk as the page you draw on (`apps/web/src/ui/chalk.ts`): grain from a small noise tile, a drier second edge to every stroke, the duster rubbing chalk out. It's painted again only when the board changes, never per frame, at 512 pixels across on the low tier, 1024 on medium (phones) and 1600 on high. The frame, legs, tray, chalk and duster are one merged mesh (`apps/web/src/world/board.ts`, a place of its own like the hall and the proving ground); with the face, two draw calls.
- **Nothing on it is lost.** Every version is kept (the app's History, `galahad board history`): clearing or erasing takes it off the face, not out of the record.
- **Solid.** The frame and its legs are a solid walkers go round; the space before it, where he stands to write, stays clear (held by a test).

## The test sites

Beyond the keep there are two places built for testing, and experiments run there when they fit.

| Site | Where | What runs there |
|---|---|---|
| The proving ground | On the heights west of the keep, 5 m above it, looking down on the keep and the lake: a north-south runway, a taxiway and an apron, a launch pad, a rover course | Aircraft (JSBSim) over the runway; rockets (RocketPy) from the launch pad; anything that asks for the field (`site: "field"`) on the course |
| The workshop | East of the keep, at the end of a level road, by the lake's arm: a hall with a wide door facing the keep, an aisle and four test cells, busy with machines that work whether or not an experiment is running (see "The workshop" below) | Anything that spans less than a test cell (10 m: an arm, a gripper, a small rig) at full size; anything that asks for the hall (`site: "hall"`), scaled to fit |

Everything else, and whatever finds its site's pads in use, stands on its own plot of open land (`site: "open"` asks for that). An ended experiment stays on its pad, dimmed, until the next one needs it; then it's cleared away (a `cleared` event). Galahad walks out to each: up the hillside to the proving ground, and into the hall by its door and along its aisle, never through a wall. The sites' places are fixed in the contract (`SITES` and `PADS` in `packages/core/src/world.ts`), so the node and every renderer agree; their plans (walls, door, runway, paving) are `hall-plan.ts` and `field-plan.ts`.

### The proving ground

A small airfield and test range, alive when nothing's being tested (which is most of the time). Built round the three pads the contract fixes, with nothing static standing on any of them.

| | |
|---|---|
| The airfield | A paved runway, 18/36, 144 m by 16 m on mown grass, with its paint (threshold bars, the numbers 18 and 36 read by a pilot on approach, touchdown bars and aiming points, a dashed centre line, edge lines, rubber in the touchdown zones), white edge lights, green threshold lights that show red along the runway, and a PAPI at each end: four lights, each red or white by the angle you see it from, as a real PAPI's (set at 3.5°, 3.17°, 2.83° and 2.5° from the runway: two red and two white on the 3° glide path, three white a little high, all white high, all red low; the lenses in their shader by the camera's angle above each unit, their halos at night with them, `field-plan.ts`' `papiWhite`). A taxiway with its yellow line, lead-off lines and a holding point, blue edge lights; an apron of concrete slabs with tie-down spots, floodlights at two corners |
| Its buildings | A hangar with an orange roof, its door open: inside, a second aircraft with its cowling off, a workbench under a pegboard of tools, shelving, drums, lamps under the trusses (the inside is lit at night). Its floor can be walked: in by the door and round the aircraft, which stays solid as it's built (fuselage, wing lower than his head, tail, wheels), to the bench. A control tower with a glazed cab leaning out, consoles, a stair up its side, antennas and the aerodrome beacon on its roof, turning white and green from dusk. A windsock in five bands, a weather mast with an anemometer, a vane, a solar panel and a Stevenson screen, a fuel bowser, a tow tug, a bench. A fence where the plateau drops towards the keep and the lake, marker boards and cones on its open edges; a gate with lamps on its posts, a barrier that lifts for Galahad, and a sign |
| The launch pad | A concrete slab, scorched round the launcher, a grated flame trench to a steel deflector, lightning masts with a wire between them, a blockhouse with a slit window and a tracking dish on its roof. The mobile launcher stands on the slab, its rail upright with a sounding rocket on it |
| The rover course | A beaten track round a loop: a washboard, staggered logs under one side's wheels at a time, a bridge with earth ramps and a plank deck (walked on as it's drawn: up a ramp a step at a time, along the deck at its height), a rock garden, a sand pit in a timber frame, a slalom, a start gate with a timing light and a charging post. Beside it, the course pad (an arena of rolled earth) for experiments |
| The drone corner | A landing pad with its charging post, three gates (hoops on stands) |

Its residents, each doing something believable while its pad is free, and making way when an experiment takes it:

| Who | Pad free | Pad taken |
|---|---|---|
| A light aircraft (a high-wing bush plane, our own design) | Flies circuits: starts up, taxis out along the line, runs up at the holding point, backtracks, turns, takes off into the wind (the runway follows the wind's way), climbs out, a right-hand pattern to the west at 32 m, base, final, flare; two touch-and-goes, then a full stop, taxi in, a pause, and again. Banked for its speed and radius (tan φ = v²/g r), nose following its flight path, wheels on the paving on the ground, the propeller turning with the power, ailerons, elevator, rudder and flaps moving; navigation lights and a landing light at night. Taxiing, it gives way to Galahad | The flight pad (the runway): it lands at the next chance, taxis in, ties down in front of the hangar and shuts down |
| The rover: NASA JPL's Open Source Rover (high tier; a stand-in with its measures elsewhere) | Drives the course; its rocker-bogie suspension settles on the obstacles as drawn (every wheel on the ground, the differential pitching the body by the mean of its rockers), its wheels roll at their own rates and its corner wheels steer for the curve; its mast looks about, at Galahad when he's near, down at the obstacles. Stops for Galahad in its way, and waits | The course pad: finishes its lap and parks at the start gate |
| A survey quadcopter | Lifts off its pad, flies its gates, then lawnmower lines over the launch pad at 13 m, comes home, lands and charges; leans into every acceleration. The tracking dish follows it | The launch pad: it leaves the survey out and flies its gates twice. (The launcher lowers its rail and drives off to park beside the blockhouse; it comes back when the pad is free) |

The windsock reads the real wind (its speed and the way it blows, `wind` and `windFrom` in the weather; a west-south-westerly, Denmark's prevailing one, when the weather doesn't say or a preset is chosen): limp in a calm, each band filling at another 3 knots, straight out from 15, shivering in gusts; the anemometer turns at a third of the wind's speed. Under reduced motion everything rests: the aircraft tied down, the rover at its gate, the quadcopter on its pad, the barrier up, nothing spinning. Hover anything for its name. The aircraft, the rover, the quadcopter and the launcher are published as movers, so walkers keep clear of them.

### The workshop

A steel-framed hall of 56 × 40 m with a sawtooth roof whose upright faces are glazed (the skylights), timber-clad walls with tall windows, and a 12 m door facing the keep. Galahad goes in by the door and along the aisle to the cell an experiment stands in, and watches from its gate. Hover anything for its name.

| | What it does |
|---|---|
| The printer farm | Seven desktop printers (CoreXY) on a bench by the door: the head traces each layer's perimeters, the bed drops a layer at a time, and the part (a gear, a bracket, a hub) grows to the nozzle. Done, the head parks, the bed drops, a sweeper bar pushes the part off down a chute onto the collector belt (each printer waits for a clear belt); the spool turns as filament is drawn off it; status lights and progress bars |
| The large-format printer | A gantry printing a rover wheel or a drone frame, its head rising a layer at a time; done, it parks out of the way for the crane |
| The bridge crane | Runs the hall's length on rails along the long walls: lifts a finished big part off the large printer with a vacuum lifter and sets it on the dispatch table, whose rollers take it into the dispatch room |
| The cart (AGV) | Waits under the end of the collector belt until its tote is full, takes it across the aisle on its marked lane to the assembly line, and comes back empty. It slows and stops short of Galahad on its lane, and doesn't move while the arm is reaching into its tote |
| The assembly line | An indexing conveyor: carriers come out of the infeed tunnel; a six-axis arm picks each part from the tote onto a carrier, the line moves on a stop, a second arm takes a screw from the feeder and drives it in, the part passes the inspection arch (a flash) and goes into the outfeed. The line moves only when there's work |
| The assembly bench | Between the printers and the first test cell: where Galahad builds every experiment. Its own bodies (its scene's shapes, not its ground) appear on the bench laid out as a kit, then are put together one after another, each lifted across to where it belongs once the simulation has said how they stand (its first frame), sized to the bench; he works there with his blade's tip, sparks flying. Gone when the test begins. One mesh (one draw call while something's on the bench), built once per experiment and put together in its vertex shader, so a frame costs it a uniform's write and allocates nothing (`assembly.ts`) |
| The test cells | Four, fenced in wire mesh, each with a light-curtain gate on the aisle and a stack light (green: free; red, the curtain armed: an experiment has it). A free cell's resident tests itself: an arm cycling a test weight through its range, a robot leg walking a treadmill (its foot carried by the belt, never slipping), a drone on a tether (spool up, lift off, hold station, land), a shake table under a three-storey frame in bursts. When an experiment takes the cell, the resident clears out (dissolves away) and comes back once it's free |
| And | A CNC mill cutting a pocket behind its window, a wind tunnel with its fan turning and a model sweeping its angle of attack, an electronics bench of live scopes, pallet racks, a tool wall, spare carts on their chargers, and shelves of filament by the door |

**Seeing in.** While the view is on the hall, its roof goes once the camera rises towards the eaves, and so does each wall the camera is outside of, down to a kerb; indoors, under the roof, everything stays. Each part either goes or stays (with a little hysteresis) and takes a third of a second to do it, in the same fine dither as everything else that gets out of the way, so you never look through a screen of half a wall (`hall-cutaway.ts`).

**Its light.** The hall lights itself, the same on every tier: what's indoors takes none of the scene's lights (so no shadow map, or the lack of one, turns it black or leaves it sunlit under a roof) and is lit instead by the sky's own colour through the glazing, by the sun (or the moon) wherever its rays really pass a skylight, a window or the door (worked out per pixel from the plan's openings: patches on the floor and on the machines; not on the low tier), and by the high-bay lamps in pools, warm and bright at night. In clear sunshine faint shafts of light slant down from the skylights and windows to their patches (on the medium and high tiers). After dark the windows and the door glow from outside, and the forecourt takes the lamps' spill (`hall-materials.ts`). Galahad and his dog, indoors, are lit as the hall is, on every tier: their materials take its own light (`Workshop.insideLight()`) instead of the scene's, eased in and out over a third of a second at the door (at once under reduced motion), so no sun lights them under the roof where there are no shadows.

**How it's built.** Pure parts, each unit-tested: the plan (`hall-plan.ts`: every wall, opening, machine and fence, and the colliders), the printers' kinematics (`hall-print.ts`), the six-axis arms' forward and inverse kinematics (`hall-arm.ts`: a spherical wrist, the tool straight down for picking and screwing, within the joints' limits), the cart's lane and driving (`hall-cart.ts`), the whole floor's work as a simulation (`hall-flow.ts`: allocation-free, every machine waiting for the next, so nothing passes through anything) and the residents' motions (`hall-cells.ts`). Drawn in seven draw calls (eight with the sun's shafts): the shell (walls and roof, which dissolve), its glass, the floor (its markings painted in its shader, so nothing on it can flicker), what stands still, what moves (one skinned mesh, a bone per moving part, about 150), the screens and belts, and the fences. About 54 000 triangles on the high tier, 37 000 on medium, 20 000 on low (fewer printers, plainer shapes); nothing is worked while the view is far from the hall, and under reduced motion everything rests.

## The weather

The world has Denmark's weather, now: the node asks Open-Meteo for DMI's own forecast model (HARMONIE) at Copenhagen and sends it down the stream as a `weather` event (cloud, rain or snow in mm an hour, visibility, the wind and where it blows from, temperature, humidity). Clear, cloudy, overcast, mist, drizzle, rain, snow and thunder are what the world can show; weather it doesn't know is shown as unknown.

- **One fixed request, nothing about you in it.** The same address every time (Copenhagen's coordinates, no key, no cookies, only an `accept` header), redirects refused, the answer checked before it's used (`packages/node/src/weather.ts`).
- **Only while someone watches.** It asks when the world is opened and then at most every 15 minutes while anyone has it open (5 minutes after a failure); with nobody watching, it doesn't ask at all. Weather older than three hours isn't shown.
- **Off switch.** `GALAHAD_WEATHER=off` in the node's environment, and it never asks; the world then shows whatever the HUD is set to.

In the app, the HUD's **Live** (the default) shows it: the wind's speed and the way it really blows (the rain leans with it, the mist, the clouds and their shadows drift with it, the windsocks point along it, and it veers smoothly when it changes), cloud cover as the cloud, rain from the mm an hour (drizzle light, 8 mm an hour or more a downpour), snow likewise (flurries light, 4 mm an hour of water or more heavy), mist from the visibility (fog under 1 km, haze to 10 km), the wind at its real speed (it leans the rain, carries the snow, moves the clouds, bends what grows and fills the windsocks; its bearing isn't reported, so it blows from the west-south-west, as it mostly does in Denmark, the same way for the rain, the clouds and the windsocks), at least overcast whenever it rains or snows; thunder is a slate sky, heavy rain and lightning (`live-weather.ts`). The clock adds it ("18:05 in Denmark · overcast, 7 °C"). Clear, Mist, Rain, Snow and Storm, in the sky card, override it (each with a wind of its own: a storm's is a gale); while the weather isn't known (or is turned off), Live is clear.

## The robots

The little machines about the keep are real open-source robots, built from their own robot descriptions, with the same parts, proportions and colours, and moved by inverse kinematics on their real joints. All are drawn 2.5 × life size so they read beside the 2.5 m knight.

| Robot | Where | What it does |
|---|---|---|
| Open Duck Mini v2 ([apirrone/Open_Duck_Mini](https://github.com/apirrone/Open_Duck_Mini)), the Microducks | On the lawns round the keep | Walks with a gait on its 10 leg joints (each foot's path solved into hip, knee and ankle angles), sways and bobs; looks about, pecks, hops; looks up at Galahad when he's close; tags along behind him or the dog |
| SO-101 ([TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)), two of them | The lab's workbench | Pick-and-place with small cubes while Galahad works at the lab (IK to each cube, gripper down), the second mirroring the first as leader and follower |
| Reachy Mini ([pollen-robotics/reachy_mini](https://github.com/pollen-robotics/reachy_mini)) | The council table | Turns body and head to watch Galahad while he's at the table; looks about otherwise. Its Stewart-platform neck is drawn as yaw, pitch and roll about the head's centre |
| Open Source Rover ([nasa-jpl/osr-rover-code](https://github.com/nasa-jpl/osr-rover-code), © 2018 California Institute of Technology) | The proving ground's rover course (high tier; elsewhere a procedural stand-in with the same measures) | Drives the course on its real joints: rockers and bogies as the suspension solver settles them on the obstacles, four corner wheels steered, six rolled. Drawn 4 × life size (2.4 m long). Its description is xacro, expanded by the build; its rockers, which the description fixes to the body, pivot as on the real rover |

`bun scripts/robots/build.ts` fetches each robot's URDF and meshes at a pinned commit, merges rigidly fixed links, simplifies the meshes to a budget (Open Duck 25 000 triangles, SO-101 15 000, Reachy Mini 30 000, the Open Source Rover 9 000) and writes a manifest and a binary per robot (each under 300 KB) into `apps/web/src/world/assets/robots/`, with `NOTICE.txt` and the Apache-2.0 licence. The files are committed, so builds never fetch. The node serves them at `/world-assets/robots/`, cached for good (their URLs carry their content's version). The world fetches them after its first frame; until they arrive, or if they can't, it draws simple stand-ins, so it never breaks. Hover a robot for its name.

## How it's drawn

Low-poly and pastel, every shape procedural (`apps/web/src/world/`). three.js on WebGPU, or WebGL2 where WebGPU isn't there. The facets are small where you look closely and large far off: more, smaller facets near the camera, never smooth.

| | |
|---|---|
| Galahad | A knightly cyborg: cream panels, orange accents, dark joints, a helm with a black visor, a glowing visor line and amber eyes, a crest, pauldrons, a short tabard, the lodestar glowing on his chest, a backpack with vents. Up close he's a machine you could take apart: bevelled plates, seams, rivets, finely segmented joints, hoses up his back and clipped cables. Pistons slide at his knees and elbows, his fingers are jointed, his seams glow. One skinned mesh (`knight.ts`, `rig.ts`). His feet are planted where they land (two-bone IK from the hips, `ik.ts`), his hands reach for the hilt, the bench or his chin, his head turns to his work, and idle, walk, run, work, think and guard blend. He steps up onto anything up to his knee (0.5 m: a tread, a flat-topped rock, the bridge's ramp) and down off it, each foot lifted over the edge and planted on the top, his body rising and falling smoothly; anything taller stops him. At the keep he climbs the stairs a tread at a time to his place on the deck, and comes down them when he leaves. He draws his sword at the lab, where its tip is his tool at the bench, and out at an experiment, where he stands guard |
| His dog | Bevelled cream plates with seams and bolts, orange panels, one big ringed camera-lens eye. The same rig: four IK legs that trot in diagonal pairs and never slide, hind legs folding when it sits (`dog.ts`). It steps by the same rule at its own scale (0.2 m): too little for the stairs' treads, so it stays below while he's on the deck; the Microducks and the animals keep to the ground |
| The picture | AgX tone mapping, its exposure set by the sun and the weather; colours blended in linear light; a sun with a lavender-and-green hemisphere fill; ambient occlusion baked into the vertex colours; an air whose colour depends on the way you look, dithered so it never bands; multisampling on medium and high tiers and on phones; a reversed depth buffer on WebGPU (`scene.ts`, `daynight.ts`, `air.ts`). Each time of day has its own grade, so it looks chosen rather than merely correct: a saturation and tints for the shadows and the highlights (amber light and lavender shade at an evening's golden hour, peach and lilac at dawn, the blue hour, a quieter, bluer night, the faintest warmth at noon), which cloud and mist quieten. It's a few multiplies in the fog node every material already runs, so every tier has it (`daynight.ts`, `atmosphere.ts`) |
| The sun and the time | "Now" is the real instant, whatever zone the viewer's device is in: the sun stands where it really is over Copenhagen (55.676° N, 12.568° E, NOAA's solar-position equations), and the moon too, in its real phase (its sphere is lit by the true direction of the sun). The look follows the sun's height and whether it's climbing or sinking, not the hour: a low sun gives golden, peach and lavender light; below the horizon come civil and nautical twilight, then deep blue night. So winter days are short and a December noon (the sun at 11°) is one long, soft golden hour, and midsummer nights stay in blue twilight. Lamps come on as the sun gets low. The HUD shows the time in Denmark ("14:32 in Denmark"); Dawn, Day, Golden hour and Night are fixed places of the sun that override it (`sun.ts`, `daynight.ts`) |
| The sky | One dome, drawn last and only where sky shows (so its shader costs the pixels of sky, not the screen). From the air at the horizon to the zenith; the sun a crisp disc in a corona, reddening as it sinks; clouds with crisp edges that gather into a deck as the cover grows, lit at their rims by the day, from below by a sun at the horizon, from inside by lightning; curtains of rain hanging under them far off; and for a strike that shows one, a jagged bolt (a white core in a blue glow, with a fork) from the cloud's base down behind the far hills at the strike's bearing, only while it flashes. From dusk the stars come out (they twinkle; cloud hides them), and the moon shows whenever it's up: the camera sees only the lowest ten degrees of sky, so the moon's height is squeezed into that strip (it rises as it does, clears the far hills quickly, and never climbs out of view), at its real bearing and in its real phase (`sky.ts`, `daynight.ts`) |
| The air | Haze, thicker far off and low down, warm and glowing towards the sun (the moon, deep in the night) and cooler away from it; where broken cloud or mist breaks the sun, rays fan from it across the sky and the haze. The same colour is the sky's horizon, so the land melts into it whichever way the light falls. On days of broken cloud, soft cloud shadows drift over the land with the wind. Where there are no light shafts (phones, WebGL2), the near air glows towards a low sun (or the moon): the shafts' forward scattering over the first 40 m, without their shadows, and at half their strength, since with nothing in shadow all of it would glow. All of it is uniform maths in the scene's one fog node: no passes, no transparent cards, next to nothing for a phone (`air.ts`, `atmosphere.ts`) |
| Fog and mist | Over the haze, a mist that thins with height above the water, summed along the line of sight in closed form, so it lies in hollows and over lakes, its top rising and falling across the land (a bank over a lake has no ruled edge); and, while the sun is low and at night, a thin sheet of it on the land where you look (on the land itself, even while he stands on a deck or a stair). Both drift in slow banks, broad ones and smaller ones of a few tens of metres, read at the point looked at and halfway to it, so the banks slide over the land as you move. Mist glows towards the light. It's thickest at dawn and after rain, a little at night, next to none by day; the sky gets a pale band of it along the horizon. All in the fog node (`atmosphere.ts`, `sky.ts`) |
| Weather | Clear, overcast, mist, drizzle, rain, snow or storm, eased into, never jumped to: clouds gather before the rain or the snow and clear after it; the ground gets wet while it rains and dries over a few minutes, and steams with mist after; snow settles while it falls and thaws after (faster in sunshine, fastest in rain), leaving wet ground; the wind rises and falls. Cloud greys the sky, lowers the exposure and softens the sun and its shadows; a storm turns it to slate. Rain and snow are streaks and flakes placed and moved on the GPU from their instance number (no buffers, no per-frame uploads; the count by tier), in three boxes that ride ahead of the camera, near, middle and far, drawn thicker and fainter with distance, so the fall has depth; the wind leans the rain and carries the snow, and flakes flutter. None falls under the workshop hall's roof (a drop over its floor is folded to nothing in the vertex shader). Rain rings the water and the puddles that gather on the paths and plazas; wet ground, rock, bark and roofs go darker and take a sheen of the sky; snow lies white on whatever faces up (ground, roofs, the tops of crowns and rocks), in patches while it's thin: all through the same few hooks the materials read (`weather.ts`, `rain.ts`, `wet.ts`). Falling rain and snow veil the far ranges. In a storm lightning strikes every few seconds, mostly within the view: a cold blue-white flash that lights the land, the air, the clouds and the rain and is gone in a fraction of a second, two pulses at most, and often a bolt in the sky (`lightning.ts`, `sky.ts`). The HUD offers Live (Denmark's weather now: see "The weather" above), Clear, Mist, Rain, Snow and Storm; the choice is kept in this browser. Under reduced motion drops and flakes hang still and faint, nothing drifts, the stars don't twinkle and there is no lightning |
| Light (high tier) | WebGPU has no hardware ray tracing, so the high tier finishes the picture through three's render pipeline instead: ground-truth ambient occlusion (GTAO, at 0.4 resolution) in creases and contacts; shafts of light, marched from the camera through the sun's (or the moon's) shadow map at 0.4 resolution, 16 steps a pixel, then blurred across neighbours of like depth and brought back to full resolution by each pixel's own depth (so silhouettes against the sky stay crisp). The air scatters forwards (a phase peaked towards the light, next to nothing to the side or behind), thicker under a low sun and in falling rain and snow, so looking towards a low sun the air glows with the shadows of the keep, its stairs and the trees cut out of it, and the shafts stay out of the way otherwise. Under a closed deck of cloud (overcast, steady rain, a storm) there's no direct light and no shafts, and the march is skipped. The fog draws the mist as lit; where the march finds the near mist in shadow, the sun's share of its light is taken away again, so shadows stand in mist as beams. Splashes where rain lands on anything that faces up, near the camera; and a soft bloom on lamps, glows, the sun and lightning. The scene pass keeps the multisampling. Phones (medium) and the WebGL2 fallback draw straight to the screen: their light in the air is the near air's glow towards the sun and the rays in the haze (see "The air"); low has the same (`post.ts`, `shafts.ts`) |
| The ground | 64 m chunks on a 4 m grid, and near the camera on a 2 m grid (`terrainFine` metres round the focus, by tier) grown a chunk at a time. The fine grid morphs into the base one in the vertex shader before the edge of its ring, so chunks meet without a crack and swap without a pop; a short skirt under every edge covers a chunk still growing. Small undulations, crags, gentle terraces and crisp stream banks give the fine grid something to show, and each cell is split along its more level diagonal so ledges stay crisp. A face's colour is its biomes' ground colours in their shares (so one ground turns into the next softly), with bare earth where it's steep, rock on crags and cliffs, mud between a marsh's tussocks and worn turf by the paths; the season lays its own colours over that in the shader. Feet, paws and plants stand on the drawn triangles, not on a smoothed height (see "The land" below; `relief.ts`, `biome.ts`, `terrain.ts`, `land.ts`) |
| What grows | Nine kinds of tree in three levels of detail by distance and tier, bushes, gorse and heather, boulders, slabs and deadwood, reeds at the water's edge, and near the camera grasses, flowers and what lies underfoot: each biome with its own mix. Every leaf, flower and blade is grown, coloured and bent in the vertex shader by the season and the wind, so nothing is rebuilt as the date creeps. Every tree, bush and rock casts a soft contact shadow. Streams come down from the hills in pools and waterfalls. The water waves, faceted, with foam where it laps the shore (see "The land" below; `flora-models.ts`, `flora-shade.ts`, `vegetation.ts`, `land.ts`) |
| The proving ground | The ground in layers a couple of centimetres apart (turf in mown stripes, a base under all paving, asphalt and concrete slabs with real joints, paint on top), so nothing ever shares a plane; buildings and props merged into one solid mesh (ambient occlusion baked in, a mask that lights the hangar's and the tower's insides at night) and one lit one (lamps, lenses that shine at night, glass); every machine in one skinned mesh on one skeleton (about fifty bones); at night their beams (the beacon's, the landing light's) and the runway's halos. Pools of lamplight from the floodlights, the hangar door and the gate fall on the ground at night (in the shader, no lights). Wet paving darkens, takes the sky at a grazing look and gathers puddles that ring with drops. Four draw calls by day (five on high, with the real rover), two more at night, and on high the solid mesh and the machines again for the sun's shadow; about 51 000 triangles on high with the real rover, 29 000 on medium, 21 000 on low; its machines stop when the camera's far, and the whole place isn't drawn beyond the land's reach (`field*.ts`) |
| The keep | Made the way a carpenter would: decks, floors and tables of planks, a shingled roof, bevelled panels with seams, framed windows with sills, capped railing posts and balusters, a solar roof with cells, the giant tree's crown in heaps of small facets, the lab's limestone hill chipped and layered, its bench a worktop over drawers, stones along the paths (`keep.ts`) |
| The workshop | A steel-framed hall with a glazed sawtooth roof, lit by its own light (the sky through its glazing, the sun's patches through its real openings, lamp pools at night), that opens part by part for the camera; its machines are one skinned mesh moved by a simulation of the floor's work (see "The workshop" above; `hall*.ts`) |
| The distance | Three hazy lavender mountain ranges, drifting low-poly clouds, and wind turbines and research domes at the horizon; nearer, a research station of panelled geodesic domes and a limestone cliff and arch in chipped layers (`scenery.ts`, `sky.ts`) |
| At night | Lit windows, lanterns, screens and runes glow warm or cool (`glows.ts`), and a few point lights by tier. Moonlight is brighter when the moon is full, and the air glows silver round the moon; with it down, the sky's glow still lights the night enough to read |
| His heart | The lodestar on his chest beats: a uniform that brightens only the star (its glow mask's white-hot part), a soft lub-dub at rest and a strong beat for a few seconds when a heartbeat runs (`care.ts`' `lodestarPulse`); steady under reduced motion |
| The camera | Close and low over his shoulder, so he's large in the frame. While he walks it swings slowly round behind him, to a side where nothing blocks the view; turned by hand, it stays where it's turned for a while. It's a body on a spring arm: carried round with the arm as the view turns, zooms and follows him (so a turn moves it exactly as far as the turn does), then eased to where the arm wants it, never faster in all than the arm's end moves plus 12 m/s. The arm lifts over the land when a hillside rises behind (the proving ground's edge), keeps some room from what it passes and tilts up over something right by him. Every move slides among the solids (round a post, along a wall, over a roof), so it never jumps, by any input, and is never inside anything (a crown, a post, a machine, a wall) or under the land; it never goes under something he isn't under. Held against something it can't slide round on its way (a wall with the arm's end beyond it), it isn't carried on along it but makes for the arm on its own side; left behind, 4 m past its arm and getting nowhere for a second (on the keep's deck as he walks off down the stairs), it cuts to the arm, as it does when he jumps somewhere. Under reduced motion it goes straight where it may. Leaves, posts and walls between it and him aren't looked round: they dissolve in a fine dither (`camera.ts`, `occlusion.ts`). A dense test turns it by hand round the keep, every station, the hall and the proving ground's edge at five distances and holds the most it moves in a frame (`camera.test.ts`); `?trace=1` on the page keeps its last 2000 frames, and Galahad's, in `globalThis.__sandboxTrace` |
| What's solid | Everything walkers and the camera meet is one world of solids (`collide.ts`): the keep's and each station's footprints (`keep-plan.ts`, held to the drawn keep by a test), the sites' walls and their places' own solids and machines, each tree's trunk and crown and each rock (`flora-plan.ts`, added and dropped with their chunk), and each plot's fence with the gap for its gate, its sign and its dome (`plot-plan.ts`, which `plots.ts` draws from too). What can be stood on has its height: the keep's stairs (each tread, the landing) and deck, the rover course's bridge, flat-topped rocks; a walker steps onto a top within its step of its feet and is stopped by anything taller (`Solids.support`, `BUILDS`). The stairs are one plan (`keep-deck.ts`) that the keep draws them from and the solids are made of, and the test that holds the footprints to the drawing covers them and their rails. Galahad plans his way round it all and off the water (`nav.ts`: the blocked part of the way searched on a grid, pulled taut into a few straight legs; up to the deck by the stairs) and slides along whatever he meets on the way; the dog keeps by him where there's room and follows in his footsteps round what stands between; the Microducks, deer, rabbits and ducks slide along what they meet and keep apart, the small giving way to the large, everyone to a site's machines. Nothing tunnels, however fast he dashes. `?colliders=1` on the page draws it all as lines, coloured by what it stops, with every walker's circle |
| Labels | Laid out on the screen so none sits on another: in order of how much each matters (his bubble, the open experiment, the experiments, their bodies, the sites, the stations, the nodes; within each, the nearer first), each stands on its anchor if that's free, else just above what's in its way (at most three times its height), else fades. A margin it has to clear before it changes its mind keeps them still as the view moves; under reduced motion they don't animate. Sizes are measured when a label is shown or changes, not every frame; the layout allocates nothing (`labels.ts`) |
| Steadiness | Land and plants grow within a few milliseconds a frame, nearest first; a chunk's fine grid is grown in two steps (its samples, then its mesh), each within the same budget. Plant instances live in pages, so a chunk uploads only its own and turning the view uploads nothing; rocks are written once, and only what has levels of detail (trees, bushes, reeds) changes pages as its level changes. The season and the wind upload nothing but a few uniforms. Shaders compile before the first frame, through the post pipeline too (every material again for its render target). Frames are paced to the display, shadows snap to texels, and labels ease onto device pixels after the camera moves |

Each tier (`tiers.ts`) caps every count and effect (a layer's cap holds across all its kinds: trees, bushes, rocks, reeds, flowers, grass, what's underfoot; and the leaves in the air), and has a triangle budget (`triangles`) the tests hold the land and its plants to at full reach, in every season: low 0.5 M, medium 1.05 M, high 1.95 M, each below what it drew before the world got finer (the cheaper small plants pay for the finer ground and trees; far bushes and far reeds are a few facets each, and a plant's vertex is 32 bytes where it was 36); to hold the frame time the resolution governor first sheds the high tier's post effects (ambient occlusion, then the light shafts, then bloom), then lowers the pixel ratio, then drops shadows, then grass. A lower pixel ratio that doesn't make frames faster is put back at once (a blurrier picture that buys nothing), and phones never go below 1. Frames that grow land aren't judged.

## The land

The land is grown from one seed, the same on every device, in three steps: its shape, its climate, and what's drawn and grows on it. Where anything stands is the seed's, the chunk's and the flats' alone: no season, no weather and no clock moves a tree or a rock (they're solid, and he plans his walks round them). The season changes only how things are drawn.

### Its shape

Gentle hills, lake basins and streams that come down in pools and waterfalls (`relief.ts`). The keep's ground, the two sites, the roads to them and every plot are level and blend into the hills round them. The home ground (the keep, the sites and the lake before them: what the map shows, 250 m round its middle) is exactly as it was. Beyond it, fading in over the next 180 m, the generator makes bigger things, each from a slow noise of its own:

| | |
|---|---|
| Ridges | Long, winding hills some ten metres over the land round them, coming and going along their length: wooded on their flanks, bare rock along their crests. Through a lake, a spit or a causeway |
| Scarps | The edge of higher country: a bank 6.6 m high (three of a stream's pools) and 40 m wide, with the higher land behind it. Its width is measured in metres, not in the noise's own measure, so it's never a cliff however the noise bunches up. A stream comes down it in three falls, one after another |
| Uplands | High, dry, rolling ground with wide views: the heaths |
| Marshes | Flats laid at the water's own level, their hollows a hand under it (pools) and their hummocks a hand over |
| Islands | In the lakes, where a cell's middle lies out in one: an uneven dome big enough for a wood; a small island is a low one |

From the keep: a ridge 380 m south-east and a higher one 400 m north, a marsh 370 m north-east, heath from 350 m south-west, an island 500 m south-east, a stream's falls down the scarp 340 m north. The land is as gentle as it was: its steepest step is no higher than before (a test holds it).

### Biomes

Every point has a climate (`biome.ts`): how high it stands over the water, how steeply it slopes and which way it faces, whether it lies in a hollow, how near a stream or a lake's basin it is, the landforms under it, and three slow noises (where the woods are, which kind of wood, how much rain the region gets). From them comes the ground's moisture, 0 dry to 1 wet: wet by the water and along the streams, in hollows and on slopes that face north; dry on high ground, on steep slopes and on the uplands. And from all of that, each biome's share of the place:

| Biome | Where | Its ground | What grows |
|---|---|---|---|
| Water | Lakes and streams' pools | | Lily pads on the still shallows of a reedy margin |
| Shore | Sand at the water's edge; dunes behind it where it's dry | Pale sand | Marram, sea lavender, pebbles, driftwood, a little gorse |
| Marsh | Wet ground at the water's level: lake margins, stream mouths, the marsh flats | A wet, deeper green, mud between the tussocks | Reeds, cattails and rushes, out into the shallows; alders and willows; kingcups and ragged robin |
| Meadow | Open ground | Lime, with sunnier and lusher patches | Grass, daisies, lupines, lavender, buttercups, campions, clover; a lone oak, a cherry |
| Heath | High, dry, open ground; the uplands | Dry olive, mauve while the heather flowers | Heather underfoot and in mounds, gorse, a lone pine or birch |
| Woodland | Where the woods are, the damper and lower of them | A deeper green | Oaks, limes, parasol trees, a cherry, an alder; ferns, anemones in spring, fallen leaves, mushrooms, logs and stumps |
| Birchwood | The woods where their own noise runs low | A lighter green under thin crowns | Birches, an oak or two; ferns, anemones |
| Pinewood | The woods where it runs high, the ground is dry or a ridge is under them | Needles in the grass | Pines and spruces; ferns, heather, mushrooms |
| Outcrop | Crags, ridge crests, the tops above the rock line | Warm limestone | Boulders and slabs, a pine or a birch, thyme |
| Lawn | The kept ground of the keep, the sites and the plots | Mown green, worn by the paths | Grass and flowers on the keep's lawn; nothing where something is built |

A biome is a share, not a line: the shares sum to 1 and change over some tens of metres. The ground's colour is mixed by them, and each thing that grows takes one of the biomes there by its share, so at an edge the two sides stand mixed. `biomeAt(seed, x, y, flats)` names the biome with the most of a point; `biomeMix` gives the shares, `moistureAt` the moisture, `climateAt` all of it. All pure, and allocation-free when given what to write into. A chunk samples its climate once, at its base grid's corners, and its faces and its growth read it from there.

### What grows

Every model is original and procedural (`flora-models.ts`), one merged geometry and one instanced mesh each, drawn only while a chunk in reach grows some:

| Layer | Kinds | Where it's drawn |
|---|---|---|
| Trees | Oak, pine, round, parasol, birch (banded white bark), cherry, spruce (a spire, darker and bluer than a pine), alder (upright, dark-barked), willow (a dome with curtains hanging round its rim) | Out to the land's reach, in three levels of detail: near (`treeDetail` metres, none on the low tier) crowns are heaps of many small facets on tapering trunks with root flares; farther (`treeLod`), simpler; far off, a few facets (five far models: broad, birch, pine, spruce, cherry) |
| Bushes | Leafy, in flower, ferns, gorse, mounds of heather | Out to the land's reach; a leafy bush far off is two heaps of leaves |
| Rocks and deadwood | Boulders, stones, layered slabs with chipped facets (gathering on crags); in the woods fallen logs and stumps | Out to the land's reach |
| Reeds | Reeds with plumes, cattails, stands of rushes | Out to the land's reach; far off, a few broad strokes |
| Flowers | Daisies with buttercups; lupines, campions and lavender; wood anemones; heather | Near the camera (`grassRadius`) |
| Grass | Tufts, lush clumps gone to seed, marram, tussocks of rushes | Near the camera |
| Underfoot | Pebbles, clover, mushrooms, fallen leaves, driftwood, lily pads (afloat: they ride the water's waves) | Near the camera |

Trees and rocks are solid, as their models are (`flora-plan.ts`, held to the models by a test): a trunk walkers go round, a crown the camera keeps out of, a skirt where a crown hangs low; a log and a stump are low enough to see over, and a low one he steps onto. Bushes, reeds and the small things aren't. Nothing grows where something is built, in a stream's pool, or (the solid things) on the trail he and the dog walk.

### The seasons

The season is Denmark's, by the real date (`season.ts`): not four switches but a year that turns. What grows reads it as a few amounts (`flora-season.ts`): how far the leaves are out and how far turned, what's in flower, how pale the grass is, how many leaves lie on the ground. Each part of each model says which amount grows it and which one colours it, the point it grows from and its place in the queue; the vertex shader does the rest, each plant a little ahead of or behind its neighbours (`flora-shade.ts`). So a crown thins leaf by leaf, a meadow comes into flower patch by patch, and nothing pops; a kind whose season is over (anemones in summer, the meadows' flowers in winter) isn't drawn at all.

| When | What you see |
|---|---|
| Spring | Buds swelling on every twig at once; blossom on the cherries for a few weeks of April and May; wood anemones white under the bare woods, gone by June; daisies from March; fresh, lighter green |
| Summer | Full lime crowns; the meadows in flower from late April to September; lily pads in flower on the still water |
| Late August | The heather flowers: the heaths go mauve, their mounds and sprigs purple |
| Autumn | Crowns turn leaf by leaf to gold, amber and coral (birches yellow first; alders and willows late and only half; conifers never) and thin as the leaves fall, one after another, so their limbs and fine twigs show through; leaves come down in the wind from the crowns nearest the view, and lie in drifts under the deciduous trees; mushrooms come up; ferns go bracken-brown; grass yellows; reeds go to straw |
| Winter | Bare crowns: long tapering limbs and a haze of twigs (a birch's dark on its white trunk, a willow's golden); conifers a little deeper; grass a pale sage; reeds and marshes straw; the last leaves on the ground a pale buff. Snow, when the weather brings it, lies on whatever faces up: limbs, boughs, the tiers of the spruces |

A turned leaf lets the sky's light through (its shaded side glows a little by day, not at night), and a thinning crown is drawn from both sides, so its last leaves are seen from under it. The colours are pastel on purpose: light and towards yellow in autumn (a shaded orange is a brown), green all winter, never mud.

With `?trace=1`, `globalThis.__sandboxSeason("spring" | "summer" | "autumn" | "winter" | "live")` looks at a season (or a number, 0 to 1, at that point of the year: 0.65 is late August), eased over a couple of seconds, and `__sandboxStats()` says what's drawn; `__sandboxLook(x, y, distance, yaw)` puts the view somewhere.

### The wind in what grows

Gusts cross the land as waves that travel the way the weather's wind blows, at its speed: a broad front every 26 m or so, bent by a slow cross-wave so it's never ruled, with a finer ripple on it. Every blade, reed and crown leans downwind, more as a front passes over it and less behind it, and brightens a little as it bends (the pale undersides of leaves, the sheen of bent grass). The land's own grass shimmers with the same waves, so they're seen crossing a meadow far beyond where its blades are drawn. In a light breeze it's a slow swell every eight seconds or so; in a gale the fronts race. Under reduced motion nothing moves.

## Running an experiment

Every experiment has a life, and the world shows it:

| Phase | What happens | Where Galahad is |
|---|---|---|
| Building | He writes and starts the simulation; its sandbox spins up; its bodies are put together | At the workshop's assembly bench |
| Testing | It runs, live | At its pad's gate (the runway, the launch pad, the course, a test cell) or its plot's: where `padKindFor` sends it, or where it asked to stand |
| Examining | It ended (done or failed): he works out what it showed | At the observatory |
| Done (or failed) | Examined; saved | Back to rest |

While someone watches the world, the node holds a simulation's first frame until he's at the bench and has put it together (his walk there and 8 s, at most 30 s; the start's answer says how long, `build`), and holds an ended one at the observatory while he examines it (his walk there and 12 s, at most a minute). With nobody watching, neither waits. A module that doesn't know phases still works: its start is building, its first frame the test, its end the examination.

**Galahad builds them himself** with `experiment_run`: a title, an engine, a Python script that uses `galahad_world`, and optionally where to test it (`site`), its extent and a time limit (default 10 minutes, at most 60). It's one job, on a sandbox host: the experiment appears at once (he walks to the bench), a fresh sandbox spins up in the right image (the Lab for MuJoCo, JSBSim, RocketPy and custom work; Gazebo's own for Gazebo) on the gateway network (models only, and the world), his script goes in (base64, never through a shell) and runs; the simulation's start fills in the bodies; then the test, the examination, and its result back to him: the experiment's id, how it ended, the examination in words, and the ends of what the script printed. If the script never starts its experiment, or stops before ending it, or runs out of time, the experiment fails saying why, and is examined like any other. The sandbox is ephemeral and the run's own (or the asking agent's quest's), destroyed afterwards whatever happened. `experiments` lists the saved ones, `experiment_examine` examines one again. His persona's guide tells him to build, test, then examine, and to report what he found. `galahad experiments run <script.py> --title … --engine …` does the same from a terminal.

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

Metres, z up (x east, y north); orientations as unit quaternions (w, x, y, z). Moving bodies get a pose in every frame; fixed ones (a ground, a ramp) in the first frame only. Frames are paced to `speed` × real time (default 1) so the motion plays as it happened. An experiment ends when its block does: done, or failed with the exception. One that stops sending frames for 90 seconds ends as failed. `ex.phase` says where it is (building, testing, examining). The script itself (`__main__`, up to 64 KB) is kept with the experiment.

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
| `POST /world/experiments` with `Authorization: Bearer $GALAHAD_TOKEN` | `{title, engine, scene: [bodies], extent?, plot?: small\|medium\|large, site?: field\|hall\|open}` | `{id, key, plot, scale, build}`: it's being built; `build` is how many seconds to hold the first frame (0: don't) |
| `POST /world/experiments/<id>/phase` with `x-experiment-key: <key>` | `{phase: "building", poses: {body: pose}}` (how its bodies stand once built: the first frame's poses), then `{phase: "testing"}` | `{phase}` |
| `POST /world/experiments/<id>/code` with `x-experiment-key: <key>` | `{name, source}` (≤ 64 KB) | `{kept}` |
| `POST /world/experiments/<id>/frames` with `x-experiment-key: <key>` | `{frames: [{t, poses: {body: [x,y,z,qw,qx,qy,qz]}, metrics?}]}` (≤ 120 per request); the first is the test, if `phase` didn't say | `{accepted}` |
| `POST /world/experiments/<id>/end` with `x-experiment-key: <key>` | `{status: done\|failed, summary?, metrics?}`: then it's examined | the experiment |

A node that predates phases answers `phase` and `code` with 404 and leaves `build` out; the module then asks it nothing new.

A body is `{id, shape, color?, fixed?, label?, trail?}`; shapes are box, sphere, capsule, cylinder, plane, mesh (≤ 20 000 vertices), aircraft and rocket (drawn by the world). The contract, with every check, is `packages/core/src/world.ts`.

## Saved experiments

Every experiment is archived on the node that ran it (`~/.galahad/experiments/<id>/`), complete and for good: nothing is cleared to make room, and only you delete one.

| Kept | As |
|---|---|
| What it was and how it went | `view.json`: title, engine, plot and scale, status, its phases and their times, summary, the node and sandbox, each readout's exact figures (count, range and when, first and last), its recording's index |
| Its model | `scene.json`: its bodies, meshes included, exactly as the simulation sent them |
| Every frame | `frames/NNNNNN.jsonl.gz`: every frame the node received, in order (one line a frame: `[t, i, x, y, z, qw, qx, qy, qz, i, …]`), gzipped a chunk (about 2 MB of text) at a time. The live stream is held to 60 frames a second; the record isn't |
| Every readout | `readouts/NNNNNN.jsonl.gz`: every sample (`[t, k, value, …]`), likewise |
| The code | `code.txt`: the script that ran it, when the module (or the run) sent it |

- **Safety only.** One limit per experiment, against a runaway simulation: 256 MB of frames and 64 MB of readouts as text (a fifth to a tenth of that on disk). That's two hours of a ten-body rig at 60 frames a second; real experiments are kilobytes to a few megabytes. If one reaches it, that stream stops there, and the record and the examination say where.
- **Small.** A running experiment holds at most one open chunk of each stream in memory, written every 5 s, whole and atomically; a restart finds the last complete write. One that was running when the node stopped is archived as failed ("the node stopped before it finished"). One that can't be read is left on disk, untouched, and logged: it's yours to delete.
- **Examined.** The examination is a pure function (`examine` in `packages/core/src/experiments.ts`): for each readout its range (and when), its final value, its trend (steady, rising, falling, peaked, dipped, oscillating, fluctuating), whether it ran away (it ended at its largest, ten times its largest in the first half), a series of at most 96 points for a chart (each stretch's extremes); then what's notable (a failure, a runaway, its own summary, a recording cut short) and all of it in words.
- **Replayed.** Pick one under Saved experiments in the selector (or press Replay in an ended one's panel) and it plays where it was tested, marked as a replay, never live: its panel plays, pauses and scrubs it, shows the readouts at the playhead and a playhead on every chart. It asks for 15 frames a second of simulation (each with what moved in the frames it stands for) and the renderer plays between them, as with a live test. A pad busy with a live test isn't taken: replay it once that's done.
- **Yours.** `galahad experiments` lists them, `show <id> [--code]` examines one, `pin`/`unpin` marks a favourite (offered first to replay), `rm` deletes one for good. Agents read them (`experiments`, `experiment_examine`); only you pin or delete.
- **For a general archive.** `ExperimentStore.archiveSince(cursor)` lists every finished experiment after a cursor, oldest first, in a stable order (the order they were finished, a sequence kept with each); `archiveEntry(id)` gives one's files (each with its role: view, scene, frames, readouts, code; its size and SHA-256) and a plain-text description of it (`experimentText` in core: what it was, its bodies, where and when it was tested, how it ended, the examination, the summary, the code) for a semantic index. Its text came from a script: an index keeps it as data.

| Route | Scope | |
|---|---|---|
| `GET /api/experiments` | `mind:read` | The newest 200, with the total and the bytes |
| `POST /api/experiments/get` `{id, code?}` | `mind:read` | One, whole (its scene too), with its examination (and its code) |
| `POST /api/experiments/recording` `{id, from?, limit?, hz?}` | `mind:read` | A page of its frames; `hz` thins it for a replay |
| `POST /api/experiments/pin` `{id, pinned}` | `mind:write`, you only | A favourite |
| `POST /api/experiments/delete` `{id}` | `fleet:admin`, you only | Gone for good |
| `POST /api/experiments/run` `{title, engine, script, site?, extent?, minutes?, on?}` | `sandbox` | experiment_run: built, tested, examined, kept (long-running; forwarded to a sandbox host) |

The world's `hello` (and a `saved` event when they change) carries the newest 24 that ended, favourites first. Experiments are the node's: the app shows the ones of the node it talks to.

## Guarantees and limits

- **Contained.** Starting an experiment needs the sandbox's own gateway token with the `world` scope (every sandbox with a network has it); its frames need the experiment's key, compared in constant time. Frames don't spend the token's budget for models.
- **Checked.** Every scene and frame is validated: known shapes, sizes in range, finite numbers, ids of letters and digits; at most 500 bodies, 60 frames a second per experiment (more are dropped, never queued), 4 MB per request.
- **Laid out.** The sites' pads are fixed. Plots on open land sit on a spiral grid of 110 m cells around the keep; they never overlap it, each other or a site (cells that would crowd one are skipped). An experiment far bigger than its plot or pad (a flight, a rocket) is scaled down to fit (`scale`).
- **Kept for good.** The world itself is in the node's memory (every running experiment and the 12 that ended most recently stand on the map; a restart starts the map fresh), and every experiment is archived complete on the node's disk (see "Saved experiments"), deleted only by you.
- **Held only while watched.** A build is held at most 30 s before its test, an examination at most a minute, and neither when nobody watches.
- **One node's world.** The app shows the world of the node it talks to; experiments on another node show in that node's world.
