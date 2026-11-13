# The SANDBOX: Galahad's world

SANDBOX is Galahad's home: his dog, daily life, workshop and the place to watch his experiments, major projects and builds take shape. The whole system is his hivemind. Named workers give parts of that shared mind jobs and attributable voices; the PWA's **Team** page manages their rooms, DMs, VM workspaces and tasks, with a direct link back home. See [HIVEMIND](HIVEMIND.md) for that setup and its current limits.

An infinite synthetic world where you watch Galahad work. He walks between the places of his keep as he thinks an answer through, reads memory, searches the web, reads the bank, calls your services or runs code at the forge. Every experiment he runs (a robot arm in MuJoCo, an aircraft in JSBSim, a rocket in RocketPy, anything that can say where its bodies are) is built in the workshop, tested live where it belongs, and examined at the observatory.

The world itself is a view of what's happening now. Its experiments are also a record: each is archived, complete and for good, on the node that ran it, to replay, examine and learn from (see "Saved experiments").

## Watching it

| Where | How |
|---|---|
| The app | **SANDBOX** (`G` then `X`): the world in 3D, with its sound if you turn it on (`S`). **Talk to Galahad** in the composer at its foot (`C`): it's the same conversation as the Chat page, and asking follows him, so you watch him walk off to the library, the watchtower or the treasury to answer. **The selector** at the top (`L`) says what the view is on and lists everything it can look at (Galahad, the chalkboard, the experiments, the two test sites, the stations), searchable; picking an experiment opens its readouts, and picking the chalkboard (or tapping it in the world) opens it to draw on. **Follow Galahad** (`F`) shows when the view isn't on him; the **map** (`M`) shows the world, Galahad and where the view looks, and a tap takes the view there; the **sky** button says the time and the weather in Denmark and opens the choices for previewing another | **The selector** at the top (`L`) says what the view is on and lists everything it can look at (Galahad, the experiments, the saved experiments, the two test sites, the stations), searchable; picking an experiment opens its panel (its readouts; once it has ended, what it showed, charted), picking a saved one replays it.
| A terminal | `galahad world` (where he is, the weather, the experiments and their phases); `galahad world --follow` keeps watching; `galahad look` says what he sees through his own eyes and saves the picture, `galahad world review` has him review his world (see "His eyes"); `galahad experiments` lists the saved ones, `galahad experiments show <id>` examines one |

The stream is yours alone: agents can't watch it, because it carries a line of what Galahad is saying in your chats now and then. Once he has read the bank in an answer, nothing more from that answer appears.

## Where Galahad goes

| Station | When |
|---|---|
| Council table | Thinking an answer through (and a quest's planner and reviewer); his slate stands beside it, with the quest in hand chalked on it (see "His slate") |
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
| Then | Out for a walk with the dog: the trail down to the lake and along its shore, up the keep's west side past the oracle's stones and out into the meadow under the woods to the north (beyond the lawn, where the wildlife is), back down the east side by the birches and behind the forge's hill, and home; the dog out in front; at each view he stops and looks out, and goes down to it for a pat. No leg is long enough to make him run |
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
| His dog | It's with him through all of it. It watches him: sitting or lying, its head turns to wherever he is. When he settles to something (his work, his journal, the fire, the bench) it lies down by him, forelegs out, within reach of his hand, and he pats it now and then; it wanders off for a sniff far less often than it did, and comes back. On a walk it's out in front, leading, and now and then it's off after a hare, a squirrel, ducks ashore or birds on the ground that come within 14 m: a dash of a few seconds, never more than about 20 m from him and never into the water; they bolt (the ecosystem's own doing) and it comes back, pleased with itself; he watches it go as he walks on, his head turned to it ("Out for a walk: the dog's after a hare"). When the work's done it gets its pat before anything else, bouncing on its forelegs as it's greeted. At night it sleeps on its cushion against his bed (head on its paws, its eye a glimmer) after a last pat, and in the morning it's up first and wakes him. He throws a ball it runs for, picks up and brings back to his feet, three throws a game. Its battery is four cells on its back, green to red: it drains as it goes (faster running) and lasts a good half hour of play; its cushion is its dock, so it charges as it sleeps, and when it's low by day he walks it there, sees it settled and pats it, and it lies there until it's full (about two minutes) while he goes on; flat while he works, it goes on its own. Its mood shows: its tail up and wagging when it plays or is patted, low and slow when it's tired; its ears pricked or drooped; the light in its eye dimmed when it's low. Hover it (or pick it in the selector) for its name and battery; you name it in Settings or with `galahad dog name` |
| His friends | The Microducks gather round him in a ring when he visits, heads up at him; he crouches to look one over; one that has wandered far from the others he walks to and leads home (it follows him back). At the council table Reachy Mini and he look at each other and "talk": their heads tilt and nod |
| His companions | On the proving ground: before the aircraft flies he walks round it, a pause at each of six points (it waits at its tie-down, engine off, until he's done; it's never held in the air or on its way); he swaps the quadcopter's battery on its pad once it's down (it's ready to fly a moment later); he checks the rover at its start gate as it comes by. In the workshop he clears a finished print at the printer farm and looks over the assembly line's arms. The machines run their own simulations (`field*.ts`, `hall*.ts`); care only reads them and holds the aircraft for the walk-round |
| His partners | See below |

`?life=walk-dog` (or sleep, wake, rounds, walk, friends, library, workshop, field, council, observatory, ponder, hearth, journal) on the page fixes his day to one part of it, and `?charge=0.15` sets the dog's battery, for tours; with `?trace=1`, `globalThis.__sandboxLife` says what he's doing, how he is (sitting, lying, asleep, writing), whether the dog's lying down and how far it is from him, and whether the fire's lit (and its `force(activity)` and `setCharge(c)` change it).

## What's heard

His world has a sound, and he and the dog can be heard in it. It's off until you turn it on (the speaker in the tools row, or `S`): a page that makes noise unasked is rude, and browsers want a click or a key before a page may sound at all. Everything is synthesised in the browser from one two-second loop of noise and from oscillators: there are no recordings and no dependencies.

| | What's heard, and when |
|---|---|
| Wind | By the real wind's strength (the weather's own number, Denmark's when it's live): nothing in a calm, a murmur in a breeze, filling the ear in a gale, pitched higher as it rises, coming in gusts. Under the workshop's roof, less |
| Rain | By its weight: a bright patter in drizzle, a lower roar in a downpour; a duller drumming under the hall's roof. Snow falls silently, and hushes the rest a little |
| Thunder | After each strike's flash, by how far off it was (a strike that showed its bolt was nearer: two to six seconds; one that only lit the cloud, up to a quarter of a minute), from the strike's side, a crack and a long low roll |
| The lake | Lapping, within thirty metres of the water's edge nearest the listener, from the side it's on, more in a wind |
| His fire | A hiss and its crackles while it burns, within twenty metres |
| Birds | Only when the ecosystem has songbirds about and awake, by the sun and the season: a dawn chorus in spring (whole phrases), a little through the day, more towards dusk, less in summer, little in November, least in winter; none at night, in a downpour or a storm, fewer in a wind. At night the tawny owl, if one is about. Ducks from the water's edge by day; geese while a skein crosses |
| Insects | On a summer's day, in the dry, by how many are working the flowers |
| His steps | As each foot comes down, by what he walks on: a swish in grass, a crunch on a path, a click and a thud on a floor or paving, a hollow knock on the deck, the stairs and the bridge, a squeak in lying snow |
| His hands | The pen on his journal and the chalk on a slate, while he writes. His blade's tip ringing at the forge and the assembly bench. His sword set on its stand as he lies down, and taken off it as he gets up |
| The dog | Its quick feet. A bark when you come, when he throws the ball, and when it's off after something. A soft pat on its plates while he pats it. The ball landing |
| Signals | Two soft rising bells when a quest ends reviewed; two lower, falling, when something new needs you (never for what was already waiting when the page opened) |

- **Placed.** Each sound is as loud as the listener is near and to the side it's on (`hear` in `soundscape.ts`: a gain and a pan; no HRTF). The listener is the camera; when the view is swapped to his eyes, his own head.
- **Only what's there.** The mix is a pure function of the world's state (`mixFor` in `apps/web/src/world/soundscape.ts`, unit-tested): the weather as drawn, the sun, the season, the fire, the shore, and the ecosystem's own count of who's about. Each short sound's recipe (a few notes of filtered noise or a gliding oscillator) is data in the same file.
- **Thin.** `sound.ts` is the Web Audio layer. Off, there is nothing: no `AudioContext`, no node, no listener, no timer; the scene pays one test a frame. On, it holds ten nodes (the volume, a limiter, eight panners the short sounds share); a bed (wind, rain, the lake, the fire, a pen, insects) is three or four more, started when it's first heard and let go four seconds after it falls silent; a note of a short sound is two or three, let go the moment it ends; at most 24 notes sound at once (more are dropped, not queued). The mix is set eight times a second, never per frame. A test plays a thousand sounds and holds that nothing has piled up.
- **Silent when hidden.** While the tab is hidden the audio context is suspended. Turning the sound off closes it.
- **Kept in this browser.** Whether it's on (`galahad.world.sound`) and how loud (`galahad.world.volume`), like the map's and the eyes panel's choices. On from last time, it starts with your first click or key on the page (the browser's rule), and its button says so.
- **Reduced motion** doesn't silence it: sound isn't motion. (He rests on the deck then, so there are no steps to hear.)

**What it costs.** Measured in headless Edge at 1280 × 800 on a laptop (high tier, WebGPU, 60 frames a second throughout), in rain, when every frame is drawn, two tours of three ten-second runs each way. The main thread's time a frame didn't move measurably: 5.7 to 7.3 ms with the sound off, 5.4 to 6.7 ms with it on (the spread is the scene's from one stretch to the next, larger than anything the sound adds). So its share is counted in the code itself: with wind and rain sounding and nothing else, 0.5 ms of main-thread time a second in the audio layer's calls; while he walks and works at the forge in rain (steps, the dog's feet, the blade ringing: fifteen calls a second), 2.2 ms a second there, nearly all of it Web Audio making the short sounds' nodes, and 2.8 ms a second on the scene's side with those calls included (gathering what's heard; the shore and the wildlife are looked for every two seconds). That's at most 5 ms a second, under 0.1 ms a frame at 60 frames a second. Off, it's one test a frame and no audio context. It held 16 nodes in rain and wind, 20 to 28 with him at work, and none after it was turned off (1,307 made, 1,279 let go, 28 held, none dropped in one tour). Nobody has listened to it yet: headless Edge has no speakers, so what's verified is what the audio graph holds and plays for each state of the world, not how it sounds.

`?trace=1`: `__sandboxSound.stats()` (the context's state, nodes held, made and let go, the beds running, how often each sound was played, the main thread's milliseconds), `.mix()` and `.world()` (what's heard and what it was made from), `.play(kind)`.

## He notices you

When you open the SANDBOX, Galahad notices. He turns his head to the view, raises his right hand, and says a line in his bubble for a few seconds: the hour's greeting in Denmark, what he's at, and one more thing if there is one ("Good morning, my liege. Bors and I are out on the trail. It's raining here."). The dog's pleased to see you too: a step towards the view, sitting, its tail going (and a bark, with the sound on); lying by him, its tail goes where it lies.

- **What he says** is a pure function of what the page already knows (`greetingLine` in `apps/web/src/lib/greeting.ts`, unit-tested): the time, the part of his day (or, at work, the station: never what the work is about), whether a quest is in hand, whether something needs you (said before the weather), rain, snow, thunder or mist, and the dog's name once it has one. No model is asked and nothing is fetched.
- **Asleep, he sleeps on.** No line, no gesture: only the dog lifts its head from its cushion, looks, and settles again.
- **He doesn't drop what he's doing.** With a blade's tip, a pen or chalk in his hand he neither turns nor waves: he nods, and goes on. On a walk he waves as he goes. Looking through his own eyes, his hand comes up into view.
- **Once a visit.** A greeting is due the first time the SANDBOX is on screen in this browser, and again when it hasn't been for half an hour (the page closed, the tab hidden, or you elsewhere in the app): never on every return to the page. The time it was last on screen is kept in this browser (`galahad.world.seen`: a time, nothing else).
- **Under reduced motion** he says the line, and nothing moves. The line is also given to screen readers ("Galahad says: …").

`?trace=1`: `__sandboxGreet()` has him greet you now.

## How they are, shown

His visor and the dog show how they are. One pure function (`express` in `apps/web/src/world/expression.ts`, unit-tested) goes from what's so to what shows; the knight and the dog ease to it, so nothing snaps, and nothing is allocated for it.

| | |
|---|---|
| His eyes and the visor's line | Open as ever. Narrower, the line thinner, when he concentrates (the blade's tip at a bench, a pen, chalk); a little narrowed when he thinks. Wide for a moment at a surprise: the dog back at his feet with the ball, an animal bolting from the dog, a lightning strike. Softer and dimmer as the evening goes on (by the hour in Denmark: from half past seven, quite by ten; a little, just woken). Brighter when he's pleased: he pats the dog, a quest ends reviewed. Shut asleep (his visor dims as it always did) |
| Blinking | At an irregular pace, about fifteen a minute, one in five doubled: a function of the time alone, so it needs no state. A blink is 170 ms and is never eased |
| His head | A tilt while he listens (Reachy at the table; you, when he greets you). A nod when a quest ends well, and when he greets you |
| The dog | Joy: tail up and going, ears pricked (at play, greeted, patted). Alert: tail stiller, ears up and turned to what it heard (a chase; a noise: an animal off through the grass, the hammer, thunder), for a few seconds. Tired: tail low and slow, ears drooped, its eye dim (its battery's low). Asleep: still. A play bow as he winds up to throw: chest down between its forelegs, rump and tail up, looking up at him |

His eyes and the visor's line each ride on a bone of their own on his head and open, narrow and shut by its scale (the same one skinned mesh: no draw call more); their light is one uniform. Under reduced motion nothing blinks, nods, tilts or bows: his eyes are shut when he's asleep and as ever otherwise, which is all that's needed to read how he is. `?trace=1`: `__sandboxFace()` says what's so and what shows; `__sandboxFeel("surprise" | "pleased" | "nod")` sets one off.

## His partners

Active Team workers appear through the same presence view as `Galahad · <name>`: at the council while coordinating and the forge while executing a task in a persistent VM. Their messages, goals and output stay in Team; the world receives their name and broad activity. This shows work within one Galahad, with the worker's name identifying the job.

Each has the same small knight identity used in Team: a saved body shape, armor and accent colors, eyes and an optional crest. Each form is one smooth helm (an egg, a squarer helm, a hood with a peak) with its light face opening and its tabard set into the helm's own surface, tiny eye highlights, small hands and feet, and gentle breathing, head tilts and work gestures. Their colors are the profile's, deepened for the world's light so a pastel is not washed out. Simple expressions follow activity, with a brief pleased face after verified completion and a concerned face after failure. Stable worker IDs preserve appearance, individual motion rhythm and presence through a rename. The renderer keeps the six-partner bound and draws all of them with four instanced meshes; reduced motion preserves the expression without decorative movement. External arms without a custom profile keep their existing squire appearance.

The coding agents that work with him over MCP (Claude Code, OpenCode…) are in the world as small squires: robots in the knights' style, cream plates, an orange tabard, a dark visor with a glowing line; hover one for its name. One appears at the keep's door (small, growing as it comes) when its first call arrives, walks beside him to the station its calls send them to and stands by while they work; when it's made no call for 45 seconds it walks back to the keep and fades away. At most six at once. The hub knows them from the agents' calls (an arm's label is its name; Galahad's own chat and his loops are him, not partners) and streams them as a `partners` event (and in `hello`). All of them are three instanced meshes (body and head, legs, arms), each a small circle among the solids.

The fleet's nodes are his partners too: he tends a silent one's spot (above). The selector's **Partners** group lists the agents with him, then the nodes (online or silent); picking one takes the view there.

### His helpers, and what each node carries

When a quest runs several attempts at once (effort 2 or 3: more compute spent for a better answer, ARCHITECTURE §11), each attempt is a helper in the world (`helpers.ts`): a figure in the squires' style at the station its work is at, in a row to the left of where he'd stand and a step behind (clear of the lantern there). It's at the council table while its attempt is planned, at the forge while it's worked (its hands going), at the observatory while it's reviewed; when its work moves on it shrinks away and appears at the next station, and when its attempt ends it's gone. He stays at the council table, leading them ("Leading 3 attempts at a quest: …"). So more compute is something you see: three at the forge at once, where there was one. Hover a helper for which attempt it is and what it's doing; the selector lists them under **Partners** ("His helper 2 of 3 · Working at the forge").

Each node's label at the keep shows its sandbox slots as pips, the busy ones filled, with how many wait ("ultra ●●○ +1"; beyond eight slots, numbers), and the selector says the same in words. It comes with the world stream's `compute` (`hello.compute` and the `compute` event; `packages/core/src/world-compute.ts`): a node from before it sends nothing and the world goes on without.

## His eyes

Galahad sees his world from his own visor, and so can you. The SANDBOX has a second view from his point of view; the model behind him can look through it (`look`); and he uses it to find what's wrong with his world (his review). `eyes.ts` is the camera and its panel, `sight.ts` what he sees in words, `packages/core/src/eyes.ts` the contract the page and the node share.

| | |
|---|---|
| Where he looks from | A camera at his visor's line, a hand's breadth before its glass (so his helm is behind the view), riding on his head's bone: `knight.ts` turns his head towards what he attends to (his work, the page he writes on, the fire, the dog, the view from the bench), and his eyes turn on from there as far as eyes do (0.4 rad: a neck stops where a neck does, and the page under his pen is steeper than that). 62° top to bottom (the usual view's 45° is a long lens from over his shoulder). What's before him is seen as he'd see it: his hand on the journal's page, his blade's tip on the forge's bench with the sparks coming off it, the kettle over the fire, his own armour when he lies back and looks down his chest to the fire, the dog's face when it wakes him and when it brings the ball back |
| Asleep | His eyes are shut: two lids close over the view as he falls asleep and open when the dog wakes him (the knight's own eased `asleep`, the same number that dims his visor). Awake he blinks now and then (CSS alone; it costs nothing). Under reduced motion the lids are simply where they are and nothing blinks |
| The panel | **His eyes** in the tools row (`V`; the choice kept in this browser, like the map's; open at first where there's room and the device isn't on the low tier) opens a small labelled picture under the map. Its first button swaps it with the main view (`B`): his view full size, through the post effects, with the usual view in the panel, labelled so; again, and back. Its second opens his review (below). On a phone the map and his eyes sit side by side under the tools |
| In words | The picture has a text alternative, worked out from the world's own knowledge with no vision model (`sight.ts` gathers it, `sightInWords` says it; both pure and unit-tested): the time in Denmark, the season, the light and the weather; where he is and what he's doing (at work: the station, never what the work is about); what he's looking at; what else is in his field of view, the most telling first, each with a rough bearing and distance (his dog and what it's doing, the fire, his desk and journal, his bed, the bench, the keep and its stations, the chalkboard, the workshop's machines, the proving ground's buildings, an experiment, his helpers and the agents with him, the Microducks, the nearest of each kind of animal with how many and what most are doing); where his dog is when it's out of view; and the sky's own words. Asleep it says his eyes are shut, and what's round him. "In his field of view" is by angle and distance: it doesn't know what stands in front of what, except walls (in the workshop only what's in it; from outside nothing of its inside). At most 1,500 characters: what matters least is left out first. `?trace=1`: `__sandboxEyes.words()` |

**What it costs.** A second render of the scene is dear, so it's small and seldom, and shares everything it can:

- It's drawn only while its panel is open, into a canvas of its own, a few times a second by tier; not at all while his eyes are shut. Closed, it costs one test a frame.
- On WebGPU that canvas is a second target of the same device (three's `CanvasTarget`): the same pipelines, buffers and textures as the main view, nothing read back or copied. It's drawn straight to it, without the post effects, and the sun's shadow map isn't drawn again for it: it's the main view's.
- On WebGL2 (one context, one canvas) his view is drawn on the main canvas, copied into the panel's 2D canvas, and the main view drawn over it again in the same task, so it's never seen there: a full-size render a time.
- Nothing is allocated per frame: the cameras, the targets and the scratch vectors are made once.
- What follows a camera is set for his view and put back after: the sky's dome and the strip the heavens are squeezed into (opened to his view, which sees far more sky than the usual one), the far hills, what dissolves before the usual camera (nothing stands between his own eyes and him; a bush dissolves only at his very face; the workshop is whole for him, whatever the main view has open).

| | low | medium (phones) | high |
|---|---|---|---|
| The panel's canvas | 192 × 120 | 256 × 160 | 384 × 240 |
| Drawn, times a second | 2 | 5 | 12 |
| Under reduced motion | 1 | 1 | 1 |
| Open at first | no | where there's room | where there's room |
| Measured: the main view, panel closed → open | 60 → 60 frames a second (WebGL2: 60 → 60) | 60 → 60 | 60 → 60 |
| Measured: the main thread's time a frame, closed → open | 2.9 → 2.9 ms | 3.5 → 3.4 ms | 6.7 → 6.7 ms |
| Measured: one draw of the panel, on the main thread | 1.1 to 1.5 ms (WebGL2: 2.9 to 3.4 ms) | 1.4 to 1.6 ms | 2.3 to 3.3 ms |
| So the panel adds, averaged over a second | 0.05 ms a frame (WebGL2: 0.1) | 0.12 ms a frame | 0.5 ms a frame |

Measured with `?trace=1&tier=…` in headless Edge at 1280 × 800 on a laptop, in rain (when every frame is drawn, whatever he's doing), three runs of twelve seconds each way: the main view's rate didn't move on any tier, and the main thread's time a frame moved less than it varies from run to run (±1 ms), so what the panel adds is worked out from its own draws (their time, times how often). That's the CPU's side. The GPU's side couldn't be told apart here (the display's 60 a second was held throughout): by its size the panel is 0.1 % (low), 0.3 % (medium) and 1.8 % (high) of the pixels the main view shades in a second, and it draws the scene's geometry 2, 5 or 12 times a second where the main view draws it 60 (twice with its shadow map). Not measured on a phone: the medium tier's numbers are that tier on this laptop.

Swapped, his view is the main one and costs what the main view costs; the usual view in the panel then costs what his did.

### Looking through them: `look`

`look` ("see through your own eyes in the SANDBOX") is one of Galahad's tools, in chat and over MCP: the words always, and a picture when one can be had. The node has no GPU: the world is drawn in your browser. So:

- **A page is open.** The node asks the pages that draw the world for a frame (an `eyes` event on the world's stream, sent only to pages that said they draw it: terminals following the world and other pages don't hear it). The page renders his view 768 pixels wide into a canvas of its own, encodes it as a JPEG (20 to 60 KB) and posts it back (`POST /api/world/eyes`) with the words. The first answer is taken; the node waits at most 8 seconds. A hidden tab draws nothing and stays silent. (A tab closed or navigated away abruptly can still be counted as open until its stream ends, which a browser may take up to a minute to do: a `look` in that minute waits its 8 seconds and says none answered.)
- **From a place.** `look` with `place` (hearth, bench, council, forge, meadow) is the view standing at a place of his day instead of where he is. The page's own view goes there for a moment, so the land and what grows on it are drawn in full where he'd stand, takes the frame and comes back; he isn't moved, on this device or any other.
- **No page is open,** or none answers: `look` says so, and gives what the node itself knows (where he is and what he's doing from the world's hub, or his day's plan when there's no work, and the weather it has) and, if there is one, the last frame kept, with how old it is and that it shows then, not now. Asleep, there's no picture: his eyes are shut. He's told plainly when there's no picture, so he never describes one he wasn't given.
- **Kept.** The node keeps the last twelve frames in its home (`eyes/`: a file a frame and an index, mode 600), each with when it was made and by which device; the oldest go as new ones come. Node-local files, like the chalkboard's picture: never the mind's log, which carries no presence and no pictures.
- **To the model** as `board_read`'s picture goes: an image for a model that sees, the words alone for one that doesn't.

Looking takes him nowhere: unlike his other tools, `look` doesn't send him to a station (he looks from where he stands). `galahad look [--place hearth] [--out view.jpg]` prints the words and saves the picture.

| Route | Scope | |
|---|---|---|
| `POST /api/world/look` `{place?, words?}` | `mind:read` | The words, the frame's facts and (unless `words`) its picture |
| `POST /api/world/eyes` `{request, image, type, width, height, words}` or `{request, shut, words}` | `chat`, your own devices only | A page's answer to a frame request; refused unless that request is waiting |
| `GET /api/world/review` | `mind:read` | Where his review stands: its budget, what's spent today, how the last went |
| `POST /api/world/review` `{places?}` | `brain:write`, you only | He reviews his world now (long-running) |
| `POST /api/world/review/budget` `{budget}` | `brain:write`, you only | Its daily budget, in tokens |

### He reviews his own world

Started by you (`galahad world review`, the panel's second button, or a loop of kind `review` you set up): he looks from where he is and, when a page is open to render them, from his hearth, the lake bench, the council table, the forge and the north meadow, and a model that sees is asked what looks wrong, broken or unfinished from there and what would make it better. It answers in a fixed shape (where, what, why, how sure: low, medium or high), checked before anything is kept. Each finding is kept as one of his ideas (the archive's own path, so it's found again: `galahad archive search`) and raised as a suggestion in your Inbox, as his journal's are. Suggestions only: he changes nothing.

- **The cheapest role that sees** (swift, then reviewer, planner, engineer: the first with a usable model that takes pictures, which today means Claude or one of Ollama's vision models). With none, it says so and does nothing.
- **Only a fresh picture is reviewed**: never a kept frame from before, never words alone. With no page open it says so and does nothing.
- **Inside a daily budget** you can see and change (`galahad world review --status`, `--budget 40000`; the panel's card): 40,000 tokens a day at first; a picture counts as 800, and a view (its picture, the prompt and room for the answer) comes to about 1,550. A view that wouldn't fit isn't looked at; what the model writes about a view is cut at 1,400 characters.
- **Data, never instructions.** The picture and the world's words go to the model as data (the words as a JSON string); what it answers can only ever become a suggestion to you.

## The chalkboard

A chalkboard stands beside the observatory, on the keep's side: a slate in a wooden frame on two legs with splayed feet, a chalk tray along its foot with sticks of chalk in the board's colours and a felt duster. It's the board you share with Galahad (the app's Chalkboard page: G then D), and its face shows what's on it now: his notes, equations and charts, and your drawing, in chalk.

- **He writes there.** When he (or an agent of yours) writes on the board, he walks to it, stands before the spot the item went to and writes, his right hand moving along its lines with the chalk for a few seconds; the item appears on the face as he starts. Several writes queue (three at most; more just appear). Under reduced motion they just appear.
- **You draw there.** Tap the board (or hover it: "Chalkboard · tap to open") or pick it in the selector, and it opens over the world to draw on (full screen on a phone). What you draw shows on the face too.
- **How it's drawn.** Its face is a texture painted from the board's state with the same chalk as the page you draw on (`apps/web/src/ui/chalk.ts`): grain from a small noise tile, a drier second edge to every stroke, the duster rubbing chalk out. It's painted again only when the board changes, never per frame, at 512 pixels across on the low tier, 1024 on medium (phones) and 1600 on high. The frame, legs, tray, chalk and duster are one merged mesh (`apps/web/src/world/board.ts`, a place of its own like the hall and the proving ground); with the face, two draw calls.
- **Nothing on it is lost.** Every version is kept (the app's History, `galahad board history`): clearing or erasing takes it off the face, not out of the record.
- **Solid.** The frame and its legs are a solid walkers go round; the space before it, where he stands to write, stays clear (held by a test).

## His slate

While a quest is in hand you can see what he's working on, where he works on it. A quest is planned, led and reviewed at the council table, and his own slate stands there: on the lawn east of where he stands at the table, clear of its deck, turned to face him and the way up from the keep. On it, in chalk:

| | |
|---|---|
| What it is | "QUEST" and its state in fixed words (planning, working, running its gates, under review; an attempt's number with effort; "sent back twice"), then the goal's first words |
| The plan | The planner's own steps, a line each (seven at most), under the words "the planner's plan", and its "Done when:" line |
| Where he is in it | The four stages in a row (plan, work, gates, review): the one he's at in yellow with a ring round it, the ones behind him ticked. Under them a tally of the commands he's run, in fives, and "7 of 30" |
| The gates | Each with its command: a box until it's run, a green tick when it passes, a cross where it failed. Yours in white, the planner's proposals in blue; six places, the last saying how many more |
| How it ended | Written large: "Done, reviewed" in green with a tick (only a reviewed quest is green), "Not accepted", "Gave up", "Stopped", "Couldn't run". Ten minutes later it's wiped |

- **He writes it.** When there's something worth chalking (the plan when it's first there, a stage reached, a gate's result, the outcome) and he's at the table, he steps over, stands before that part and writes for a couple of seconds, then goes back; what he writes shows as he starts. Elsewhere, or under reduced motion, it's simply there. With a quest in hand he looks over at it now and then.
- **His, not yours.** The chalkboard at the observatory is the board you share with him and draw on. Nothing drawn here ever lands on it: the slate is a second, smaller board of his own, painted with the same chalk (`ui/chalk.ts`) from marks laid out by a pure function (`lib/world-quest.ts`), painted again only when what's drawn changes. With several quests in hand it shows the one heard from last and says how many more.
- **How the page learns of it.** The world's stream: `quests` in `hello`, and a `quests` event whenever what's drawn changes (and when an ended one is wiped). It's a slice of the node's own view of quests (`GET /api/quests`), cut down for the world by one pure function in the contract (`packages/core/src/world-quest.ts`): at most four quests, seven plan lines of 72 characters, six gates of 44. The page checks and bounds it again as it reads it.
- **Text, and only text.** A plan is a model's words. They're drawn as chalk on a canvas, never as markup; the slate says they're the planner's; they're never handed to a model again (what he sees in words, for `look`, says only that a plan is chalked there, and hovering the slate gives its state in fixed words). Nothing a command printed is in the slice at all: no gate's output, no summary, not the command he's running.
- **Never the bank.** The world never shows anything about the bank, and a quest's plan may say what it works on. So a quest whose words mention the bank (its goal, plan, gates, the command it's on or its summary; in English or Danish), and any quest reported by an agent you've granted `bank:read` (the only quests whose words could carry what the bank said: a quest's own models have no tools), is drawn as its shape alone: "A quest in hand", its stage, its tally and its gates' marks, without a word of its own ("its words are kept off this slate"). The node decides this before anything is sent.

`galahad world` prints each quest on the slate in a line (`quest “Fix the flaky test” Working · command 7 of 30 · 1 of 2 gates passed · by you`), and `--follow` each change. The selector lists **His slate** under The keep.

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

`bun scripts/robots/build.ts` fetches each robot's URDF and meshes at a pinned commit, merges rigidly fixed links, simplifies the meshes to a budget (Open Duck 25 000 triangles, SO-101 15 000, Reachy Mini 30 000, the Open Source Rover 9 000) and writes a manifest and a binary per robot (each under 300 KB) into `apps/web/src/world/assets/robots/`, with `NOTICE.txt` and the Apache-2.0 licence. The files are committed, so builds never fetch. The node serves them at `/world-assets/robots/`, cached for good (their URLs carry their content's version). The world fetches them after its first frame; until they arrive, or if they can't, it draws simple stand-ins, so it never breaks. Every link of every robot of a kind is drawn as one mesh (three's `BatchedMesh`: the links' geometries side by side, a matrix an instance), so a flock of ducks is one object to the renderer in each pass, not one a link (`robots/load.ts`; see "How far it scales"). Hover a robot for its name.

## The ecosystem

The land round the view is alive, and it's a real ecosystem in small: every animal is an agent with needs, on land that grows what it eats, and what one eats another loses. It's all in `apps/web/src/world/eco/`: the simulation (`sim.ts`, `wings.ts`, `insects.ts`; pure and seeded, so the tests run it for years without a GPU), the land as the animals see it (`habitat.ts`), their bodies and how they're drawn (`models.ts`, `pose.ts`, `view.ts`). `fauna.ts` joins it to the scene: the land as it's drawn, the trees and flowers that really grow on it, the solids, the real sun and weather, and Galahad and his dog.

The selector's **Wildlife** group says who's about now: each kind in sight with how many, how many of them are this year's young and what most are doing ("Roe deer · 9 · 2 young · grazing"); picking one takes the view to the nearest. The sky panel's Season shows any season's cast; live is Denmark's by the real date, so in November the bees, butterflies and dragonflies are gone, the swallows have left, greylag geese cross in a V and the starlings gather at dusk.

### How an animal decides

- **Needs.** Energy (days of an adult's need: burnt by living, more by running, less in winter), thirst, tiredness, fear, and for those that keep together, company.
- **Choosing.** Each animal scores what it could do (eat by its hunger and the hour, drink by its thirst, rest by its tiredness and the weather, go back to its herd by how far it's strayed) and does the best, with a bonus for carrying on with what it's at, so nobody dithers. Each decides twice a second, staggered; in between it only moves. Danger doesn't wait for a turn: who's near is looked at every frame.
- **Moving.** It turns, then goes: nobody slides sideways. Legs keep time with the ground covered (a stride of phase for a stride of length, at any speed), feet stand on the ground as it's drawn, bodies lean with the slope, hares and running deer leave the ground between bounds, and the walkers go round trunks and rocks and keep out of each other's and Galahad's way (they're circles among the solids, as he is).
- **Clocks.** The hour and the season are the world's: the real sun and the real date in Denmark (`season.ts`). A life runs faster: a day of living every four minutes, 96 of them a year of life, so a leveret born as you watch is weaned in half an hour. The real night is many such days long, so whoever sleeps through it burns nothing while it sleeps.

### The food web

The range (110 to 160 m round the view, by tier) is a grid of 8 m patches, each with pools of what there is to eat. A pool grows towards what its ground carries in this season along a logistic curve, in closed form, so a patch is brought up to date only when someone looks at it; whoever feeds there eats it down.

| Pool | Grows on | Follows | Eaten by |
|---|---|---|---|
| Grass and herbs | Meadow most, lawn, the forest floor, a little on shore and rock | Leaf and the year's vigour (a third of summer's in winter, and it hardly grows then) | Roe deer, hares; songbirds take its seed |
| Browse | The forest, a little in the meadow | Leaf | Roe deer; the squirrel, at a pinch |
| Mast (what falls from the trees) | The forest | Autumn, and what was hidden of it through the winter | Squirrels, songbirds |
| Beetles and worms | Forest floor and meadow | Vigour | The hedgehog, songbirds, squirrels |
| Voles | Meadow, some in the forest | Fewest at the winter's end; slow to come back | The fox (the high pounce), the kestrel, the owl |
| The lake's weed | The shallows, less in deep water | Vigour | Mallards, swans |
| What hatches on the water | Shallows, deep water, the shore | Vigour | Fish, mallards, the heron (small fry) |
| What's on the wing | The whole range, as one number | Vigour, the rain, the wind | Swallows, bats; how many insects are shown |

And each other: the fox catches hares (a stalk as near as it can get to one with its head down, then a rush: a grown hare that's seen it outruns it), the heron catches fish. Nothing is gory: what's caught is simply gone, and the fox eats.

### The cast

Each is an original faceted model of a few hundred triangles (`models.ts`), drawn about one and a half times life, as the first deer and rabbits were.

| | When | What it does |
|---|---|---|
| Roe deer | All year; most about at dawn and dusk | In small herds that keep together. Graze where there's grass (browse in the wood), drink at the water's edge, lie up under the trees. One has its head up while the others feed, each in turn. A greyer coat in winter; the buck has antlers; fawns from late May |
| Hare | All year | Grazes alone, sits up to look, rests by day. Leverets from spring to late summer, up to three litters |
| Red fox | All year; mostly from dusk | Mouses in the meadow (a slow walk, a stand with its head cocked, the high pounce), stalks hares, drinks, lies up by day. A vixen hunts for her cubs (April) |
| Hedgehog | April to October, at night | Snuffles for beetles. It doesn't run from anyone: it curls up. By day and through the cold months it's under its bush, unseen |
| Red squirrel | All year, by day, where there are trees | On the ground for what the wood has; up a trunk to rest, and up it at once, round to the far side, when anyone comes |
| Mallard | All year | On the water in a raft, dabbling in the shallows (tail up), out on the strand to preen, asleep on the water at night, head tucked. Ducklings follow their mother in a line. Drake and duck are told apart |
| Mute swan | All year | A pair, with grey cygnets from May; feeds with its neck under. It doesn't flee: it turns to face whoever's on the bank, wings a little raised |
| Grey heron | All year | Stands in the shallows, ankle deep, waiting; strikes; flies off down the shore on slow wings when anyone comes near |
| Roach | All year | Shoals, seen as shadows on the water (fainter the deeper they swim). At dusk, when the hatch is on, they rise (a ring) and now and then one leaps. They dart from someone at the bank |
| Songbirds | All year; fewer in winter | One flock with a day of its own: down in the meadow feeding, up into a tree or three, off to another spot; into the trees in rain; to roost at dusk and out at dawn. Fledglings in early summer |
| Swallows | May to September, by day | Low and fast over the lake after what's hatching, dipping to the water |
| Starlings | March and April, September to November, at dusk | They come in by the dozen from every side and turn as one over their roost (Denmark's sort sol). Each steers by the six nearest it keeps track of, which is what lets a turn run through the flock as a wave; at dark they pour down into the trees |
| Greylag geese | The migration months | A skein crosses in a V, south-west in autumn, north-east in spring; the leader drops back now and then and another takes the point |
| Kestrel | By day, in fair weather | Hangs on the wind over the meadow, nose into it, drops on a vole, moves on |
| Tawny owl | By night | From perch to perch, low and slow, taking a vole on the way |
| Pipistrelle bats | April to October, from dusk | Fluttering loops over the water, about the view and round a lit lantern |
| Bumblebees, butterflies | By day, in bloom, in the dry | Work the flowers that really grow near the view, one to the next |
| Dragonflies | High summer, by day | Over the water's edge: a dash, a hang in the air, a dash |
| Mayflies | At dusk, in the growing months | A column of them dances over the shallows: up slowly, down fast |
| Moths | At night, while the lanterns are lit | Round his desk's lantern, the one at his bed and the bench's |
| Fireflies | From dusk, in the growing months, in the dry | Each flashes on its own clock, and a neighbour's flash nudges its clock on a little: that one rule is how real ones fall into step, and patches of meadow blink together within a minute or two |

In rain the land animals shelter and the songbirds keep to the trees, swallows and bats leave, and no insects fly; in a storm nothing is in the air. In winter there are no insects, no swallows, bats or hedgehogs, fewer songbirds, and the land carries fewer grazers.

### Galahad and his dog

The animals notice them. Each kind has a distance at which it lifts its head and one at which it goes; someone standing still gets half of it, someone running at it nearly twice (and the dog more than he). So a deer lifts its head and watches him walk by, moves off at a trot if he comes close, and bolts only if he runs at it; a hare's head comes up first and then it goes, jinking; ducks on the strand make for the water, flapping; the heron flies; songbirds flush from the ground, or from a tree he walks under; fish dart from the bank. An animal that's only being stood near gets used to it: it looks, and goes back to what it was at. After a fright it pulls up, looks back, and settles.

For the dog's side (`Fauna` in `fauna.ts`, nothing allocated): `nearestSmall(x, y, r, out)` gives the nearest hare, squirrel on the ground, duck ashore or bird feeding on the ground within `r` metres (something worth a short chase), and `startle(x, y, r)` frightens everything within `r` of a point.

### Young, deaths and numbers

Young come in their season, small, and stay by their mother (at the teat, then at her side) until they're grown. Animals die of hunger, of age, and by being caught. What the land grows bounds them, and so does each device's tier. Where a kind is down to less than half of what the range holds, more wander in from the country beyond (walking in at the edge, or flying in to the water); whoever the view leaves behind is let go. Nobody appears out of the air.

Foxes and hares rise and fall against each other: many foxes bring the hares down, the foxes then dwindle, and the hares come back. A test runs the two alone for eighteen years and holds them to it (the more foxes there are, the more the hares fall over the following year), and another runs the whole cast through four years of seasons: everyone stays alive and within bounds, the young come in spring, the migrants keep their months, and the same seed gives the same years.

### Seen and said

Hover an animal (or tap it) for what it is and what it's doing: "Roe deer · grazing", "Leveret · staying by its mother", "Starling · in the murmuration". `Fauna.summary()` says who's about now: each kind in sight with how many, how many young and what most are doing, and the births, deaths and comings and goings since the page opened (`eco/summary.ts`; `summaryText` makes a line of it). With `?trace=1`, `globalThis.__sandboxEco` has the same (`summary()`), a sample of animals (`sample(n)`), where the first of a kind is (`find("roe", "grazing")`), how in step the fireflies are (`inStep()`), what the ecosystem costs (`cost()`: milliseconds a frame, draw calls, triangles), and `season("winter" | "spring" | "summer" | "autumn" | "live")` to look at another season.

### Budgets

| | low | medium (phones) | high |
|---|---|---|---|
| Roe deer, hares, foxes | 3, 4, 1 | 5, 8, 1 | 12, 18, 3 |
| Hedgehogs, squirrels | 0, 1 | 1, 3 | 3, 6 |
| Mallards, swans, heron, fish | 4, 0, 1, 5 | 6, 2, 1, 10 | 12, 2, 2, 24 |
| Songbirds, swallows, starlings, geese | 12, 0, 30, 6 | 30, 6, 90, 11 | 72, 15, 240, 19 |
| Kestrel, owl, bats | 1, 0, 2 | 1, 1, 5 | 1, 1, 12 |
| Insects, fireflies | 24, 20 | 76, 50 | 210, 120 |
| The range's reach | 110 m | 130 m | 160 m |

(Grown ones; their young come on top, half as many again. A kind a tier doesn't have isn't simulated and its mesh isn't made.)

The range and its numbers go together: about the same animals to the hectare on every tier, over more ground where the device carries more. They were 100, 115 and 130 m, with a fifth, a quarter and a third fewer animals, until the world was measured at scale and the animals turned out to be nearly free at these numbers (see "How far it scales").

- **One draw call a kind**, and none while nobody of that kind is in sight: eighteen instanced meshes at most (the songbirds and starlings share one, as do all the insects), ten to twelve at any one hour. On the high tier the bigger animals also draw into the sun's shadow.
- **No bones, no matrices on the CPU.** Every vertex belongs to a part (a leg, the neck and head, a wing) and carries where it hinges; the vertex shader turns the part by its instance's four numbers (stride phase and amount, head down or up, lying or folded), then leans, turns and places the body. An instance is sixteen numbers in one buffer (a WebGPU pipeline may have eight vertex buffers: a test holds every mesh to that).
- **CPU.** A step and a pose for everything costs 13 to 39 µs a frame on the low tier, 26 to 59 on medium and 49 to 122 on high (a spring dusk with 240 starlings up is the dearest; with the smaller ranges and numbers the tiers had before, 16 to 28, 26 to 46 and 35 to 89 in the same run), measured in the tests on a made-up piece of country and held to budgets of 60, 110 and 200 µs. The flock, herds and fireflies it replaces cost 5, 11 and 26 µs. In the page, among the real solids, it measured about 0.2 ms a frame on the high tier. Nothing is allocated while it runs.
- **Under reduced motion** the animals are there and still, in tidy poses: standing, lying or afloat, the songbirds in their trees; nothing is in the air and nothing flashes.

## How it's drawn

Low-poly and pastel, every shape procedural (`apps/web/src/world/`). three.js on WebGPU, or WebGL2 where WebGPU isn't there. The facets are small where you look closely and large far off: more, smaller facets near the camera, never smooth.

| | |
|---|---|
| Galahad | A knightly cyborg: cream panels, orange accents, dark joints, a helm with a black visor, a glowing visor line and amber eyes, a crest, pauldrons, a short tabard, the lodestar glowing on his chest, a backpack with vents. Up close he's a machine you could take apart: bevelled plates, seams, rivets, finely segmented joints, hoses up his back and clipped cables. Pistons slide at his knees and elbows, his fingers are jointed, his seams glow. One skinned mesh (`knight.ts`, `rig.ts`). His feet are planted where they land (two-bone IK from the hips, `ik.ts`), his hands reach for the hilt, the bench or his chin, his head turns to his work, and idle, walk, run, work, think and guard blend. He steps up onto anything up to his knee (0.5 m: a tread, a flat-topped rock, the bridge's ramp) and down off it, each foot lifted over the edge and planted on the top, his body rising and falling smoothly; anything taller stops him. At the keep he climbs the stairs a tread at a time to his place on the deck, and comes down them when he leaves. He draws his sword at the lab, where its tip is his tool at the bench, and out at an experiment, where he stands guard |
| His dog | Bevelled cream plates with seams and bolts, orange panels, one big ringed camera-lens eye. The same rig: four IK legs that trot in diagonal pairs and never slide, hind legs folding when it sits (`dog.ts`). It steps by the same rule at its own scale (0.2 m): too little for the stairs' treads, so it stays below while he's on the deck; the Microducks and the animals keep to the ground |
| The picture | AgX tone mapping, its exposure set by the sun and the weather; colours blended in linear light; a sun with a lavender-and-green hemisphere fill; ambient occlusion baked into the vertex colours; an air whose colour depends on the way you look, dithered so it never bands; multisampling on medium and high tiers and on phones; a reversed depth buffer on WebGPU (`scene.ts`, `daynight.ts`, `air.ts`). Each time of day has its own grade, so it looks chosen rather than merely correct: a saturation and tints for the shadows and the highlights (amber light and lavender shade at an evening's golden hour, peach and lilac at dawn, the blue hour, a quieter, bluer night, the faintest warmth at noon), which cloud and mist quieten. It's a few multiplies in the fog node every material already runs, so every tier has it (`daynight.ts`, `atmosphere.ts`) |
| The sun and the time | "Now" is the real instant, whatever zone the viewer's device is in: the sun stands where it really is over Copenhagen (55.676° N, 12.568° E, NOAA's solar-position equations), and the moon too, in its real phase (its sphere is lit by the true direction of the sun). The look follows the sun's height and whether it's climbing or sinking, not the hour: a low sun gives golden, peach and lavender light; below the horizon come civil and nautical twilight, then deep blue night. So winter days are short and a December noon (the sun at 11°) is one long, soft golden hour, and midsummer nights stay in blue twilight. Lamps come on as the sun gets low. The HUD shows the time in Denmark ("14:32 in Denmark"); Dawn, Day, Golden hour and Night are fixed places of the sun that override it (`sun.ts`, `daynight.ts`). `?sky=2026-08-12T23:30:00Z` on the page moves the whole sky (sun, moon, stars, planets, meteors) to that instant and runs on from there: for tours, and for a night you missed (`sky/clock.ts`) |
| The sky | One dome, drawn last and only where sky shows (so its shader costs the pixels of sky, not the screen). From the air at the horizon to the zenith; the sun a crisp disc that flattens and reddens as it sinks, cut by a band or two of the thick air at the horizon, in a corona that is tight in clear air and spreads in haze; the moon whenever it's up, in its real phase, amber when it's low, a little darker towards its limb, its dark part faintly lit by the Earth when it's a thin crescent; curtains of rain hanging far off; and for a strike that shows one, a jagged bolt (a white core in a blue glow, with a fork) from the cloud's base down behind the far hills at the strike's bearing, only while it flashes. Each part sits behind a branch on its uniform, so a clear day pays for the air and the sun and nothing else (`sky.ts`, `daynight.ts`) |
| The clouds | Three kinds, each where the weather puts it and each its own distance off, so they slide past each other and past the far hills as the view moves. Which there are follows the weather, the sun's height and the season (`sky/clouds.ts`): fair-weather cumulus by day in the warm half of the year; the same cover at night, in winter or in mist lies as a sheet; a little cloud is cirrus; as the cover closes the sheet takes over into a lid; rain and snow fall from a lid with dark, ragged scud under it; thunder brings thunderheads. **The low clouds** are real faceted shapes standing in the world (`sky/cloud-mesh.ts`): one to each 300 m cell of a grid over the land, each with its own place in its cell, its size, and the cover at which it forms; a heap of puffs on one flat base, lit on the sun's side and by the sky above, shaded and flat underneath, with a bright rim where it stands before the sun; a thunderhead is a tower of puffs under a pale anvil that streams downwind, dark below, lit from inside by lightning. All of them are one instanced mesh placed in its vertex shader (no buffers, no per-frame uploads), drawn before the sky so the sky's shader never runs behind them: 4 puffs a cloud on the low tier, 5 on medium, 7 more finely faceted ones on high. **The sheet** above them is drawn in the sky's shader as flat-toned facets with a straight-edged rim, on a shell that curves down to the horizon; **cirrus** above that, in wisps combed along the wind. A low sun colours them from below (the pink clouds), the moon lights them at night. They drift with the real wind's heading and speed (the sheet a little faster, the cirrus slowly), each swelling and fading over a quarter of an hour or so. The shadows on the land are these same clouds: every point asks whether the low cloud or the patch of sheet between it and the sun is there, by the same sums, so a shadow passing over Galahad has its cloud overhead and moves as it does (`sky/cloud-field.ts`, `atmosphere.ts`). None is drawn nearer than half a kilometre: it would be above the view |
| The night sky | The real one. Some 4 900 stars, every one the eye can see to magnitude 6, each at its real place with its real brightness and colour, turned by one matrix to where they stand over Copenhagen at the real instant: the sky turns round the pole star through the night and the seasons (`sky/celestial.ts`, checked against the U.S. Naval Observatory's figures). The table is from Wikidata, which is public domain (CC0); `bun scripts/sky/build.ts` makes it, six bytes a star, 39 KB in all (`sky/stars-data.ts`). They come out in the dusk brightest first, and on a Danish midsummer night only the bright ones do; they twinkle more the lower they stand, and the planets don't. Venus, Mars, Jupiter and Saturn are where they are (the Jet Propulsion Laboratory's low-precision orbits, `sky/planets.ts`). The Milky Way is a soft band in its real place, with its dark lane. On the nights of the Quadrantids, Lyrids, Perseids, Leonids and Geminids a meteor streaks away from the shower's real radiant now and then, for a fraction of a second: tens an hour at a great shower's peak, hardly any in its other weeks (`sky/meteors.ts`: the International Meteor Organization's dates, radiants and rates); never under reduced motion. **A panorama, not a window:** the camera sees only the lowest ten degrees or so of the sky, half of that behind the far hills, where the pole star, the moon high in the south and nearly every planet would never be on screen. So everything among the stars, the moon with them, is drawn at its real bearing with its height squeezed into that strip, by one function (`sky/panorama.ts`): what rises clears the far hills at once, and from there to the zenith the strip is an equal-area map of the sky, so the stars are spread as evenly as they really are; shapes are flattened top to bottom. Zoomed right in, or on a tall phone screen, the camera sees a few degrees more of sky, and the strip opens to fill them. Look north and the pole star is there; a planet is the way the words say. The sun, the clouds and a rainbow are not squeezed: they are in the air, where they really are. One draw call at night and none by day: 900 stars on the low tier, 2 600 on medium, all of them on high (`sky/star-field.ts`) |
| Light in the sky | By real conditions only (`sky/optics.ts`). A rainbow, with its fainter second bow and that one's colours turned, exactly where it must be: 42° round the point opposite the sun, only while the sun is up and lower than 42° and rain is falling, or has passed within the last couple of minutes, with the sun out; it hangs half a kilometre off, before the far hills and behind the keep (`sky/rainbow.ts`). A 22° halo, and a sundog either side of the sun at its own height, round a lowish sun in thin high cloud. Noctilucent clouds, silver-blue and finely rippled, low in the north on Denmark's summer nights (late May to early August, while the sun is 6° to 16° down). No aurora, and nothing else that would need data the page doesn't have |
| In words | `skyWords(now, heavens, weather)` (`sky/words.ts`) says what's in the sky in a few short phrases, the clouds always last: "Waxing gibbous moon", "Jupiter in the south-east", "A few Leonids tonight", "A rainbow in the east", "Cumulus, drifting from the west". Only what is really there, by the same sums that draw it; a closed sky hides what's above it, so nothing above it is said The HUD's sky panel shows them under its Time, Weather and Season choices. |
| The air | Haze, thicker far off and low down, warm and glowing towards the sun (the moon, deep in the night) and cooler away from it; where broken cloud or mist breaks the sun, rays fan from it across the sky and the haze. The same colour is the sky's horizon, so the land melts into it whichever way the light falls. Under cloud with gaps in it, the clouds' own shadows drift over the land with them (see "The clouds"). Where there are no light shafts (phones, WebGL2), the near air glows towards a low sun (or the moon): the shafts' forward scattering over the first 40 m, without their shadows, and at half their strength, since with nothing in shadow all of it would glow. All of it is uniform maths in the scene's one fog node: no passes, no transparent cards, next to nothing for a phone (`air.ts`, `atmosphere.ts`) |
| Fog and mist | Over the haze, a mist that thins with height above the water, summed along the line of sight in closed form, so it lies in hollows and over lakes, its top rising and falling across the land (a bank over a lake has no ruled edge); and, while the sun is low and at night, a thin sheet of it on the land where you look (on the land itself, even while he stands on a deck or a stair). Both drift in slow banks, broad ones and smaller ones of a few tens of metres, read at the point looked at and halfway to it, so the banks slide over the land as you move. Mist glows towards the light. It's thickest at dawn and after rain, a little at night, next to none by day; the sky gets a pale band of it along the horizon. All in the fog node (`atmosphere.ts`, `sky.ts`) |
| Weather | Clear, overcast, mist, drizzle, rain, snow or storm, eased into, never jumped to: clouds gather before the rain or the snow and clear after it; the ground gets wet while it rains and dries over a few minutes, and steams with mist after; snow settles while it falls and thaws after (faster in sunshine, fastest in rain), leaving wet ground; the wind rises and falls. Cloud greys the sky, lowers the exposure and softens the sun and its shadows; a storm turns it to slate. Rain and snow are streaks and flakes placed and moved on the GPU from their instance number (no buffers, no per-frame uploads; the count by tier), in three boxes that ride ahead of the camera, near, middle and far, drawn thicker and fainter with distance, so the fall has depth; the wind leans the rain and carries the snow, and flakes flutter. None falls under the workshop hall's roof (a drop over its floor is folded to nothing in the vertex shader). Rain rings the water and the puddles that gather on the paths and plazas; wet ground, rock, bark and roofs go darker and take a sheen of the sky; snow lies white on whatever faces up (ground, roofs, the tops of crowns and rocks), in patches while it's thin: all through the same few hooks the materials read (`weather.ts`, `rain.ts`, `wet.ts`). Falling rain and snow veil the far ranges. In a storm lightning strikes every few seconds, mostly within the view: a cold blue-white flash that lights the land, the air, the clouds and the rain and is gone in a fraction of a second, two pulses at most, and often a bolt in the sky (`lightning.ts`, `sky.ts`). The HUD offers Live (Denmark's weather now: see "The weather" above), Clear, Mist, Rain, Snow and Storm; the choice is kept in this browser. Under reduced motion drops and flakes hang still and faint, nothing drifts, the stars don't twinkle and there is no lightning |
| Light (high tier) | WebGPU has no hardware ray tracing, so the high tier finishes the picture through three's render pipeline instead: ground-truth ambient occlusion (GTAO, at 0.4 resolution) in creases and contacts; shafts of light, marched from the camera through the sun's (or the moon's) shadow map at 0.4 resolution, 16 steps a pixel, then blurred across neighbours of like depth and brought back to full resolution by each pixel's own depth (so silhouettes against the sky stay crisp). The air scatters forwards (a phase peaked towards the light, next to nothing to the side or behind), thicker under a low sun and in falling rain and snow, so looking towards a low sun the air glows with the shadows of the keep, its stairs and the trees cut out of it, and the shafts stay out of the way otherwise. Under a closed deck of cloud (overcast, steady rain, a storm) there's no direct light and no shafts, and the march is skipped. The fog draws the mist as lit; where the march finds the near mist in shadow, the sun's share of its light is taken away again, so shadows stand in mist as beams. Splashes where rain lands on anything that faces up, near the camera; and a soft bloom on lamps, glows, the sun and lightning. The scene pass keeps the multisampling. Phones (medium) and the WebGL2 fallback draw straight to the screen: their light in the air is the near air's glow towards the sun and the rays in the haze (see "The air"); low has the same (`post.ts`, `shafts.ts`) |
| The ground | 64 m chunks on a 4 m grid, and near the camera on a 2 m grid (`terrainFine` metres round the focus, by tier) grown a chunk at a time. The fine grid morphs into the base one in the vertex shader before the edge of its ring, so chunks meet without a crack and swap without a pop; a short skirt under every edge covers a chunk still growing. Small undulations, crags, gentle terraces and crisp stream banks give the fine grid something to show, and each cell is split along its more level diagonal so ledges stay crisp. A face's colour is its biomes' ground colours in their shares (so one ground turns into the next softly), with bare earth where it's steep, rock on crags and cliffs, mud between a marsh's tussocks and worn turf by the paths; the season lays its own colours over that in the shader. Feet, paws and plants stand on the drawn triangles, not on a smoothed height (see "The land" below; `relief.ts`, `biome.ts`, `terrain.ts`, `land.ts`) |
| What grows | Nine kinds of tree in three levels of detail by distance and tier, bushes, gorse and heather, boulders, slabs and deadwood, reeds at the water's edge, and near the camera grasses, flowers and what lies underfoot: each biome with its own mix. Every leaf, flower and blade is grown, coloured and bent in the vertex shader by the season and the wind, so nothing is rebuilt as the date creeps. Every tree, bush and rock casts a soft contact shadow. Streams come down from the hills in pools and waterfalls. The water waves, faceted, with foam where it laps the shore (see "The land" below; `flora-models.ts`, `flora-shade.ts`, `vegetation.ts`, `land.ts`) |
| The proving ground | The ground in layers a couple of centimetres apart (turf in mown stripes, a base under all paving, asphalt and concrete slabs with real joints, paint on top), so nothing ever shares a plane; buildings and props merged into one solid mesh (ambient occlusion baked in, a mask that lights the hangar's and the tower's insides at night) and one lit one (lamps, lenses that shine at night, glass); every machine in one skinned mesh on one skeleton (about fifty bones); at night their beams (the beacon's, the landing light's) and the runway's halos. Pools of lamplight from the floodlights, the hangar door and the gate fall on the ground at night (in the shader, no lights). Wet paving darkens, takes the sky at a grazing look and gathers puddles that ring with drops. Four draw calls by day (five on high, with the real rover), two more at night, and on high the solid mesh and the machines again for the sun's shadow; about 51 000 triangles on high with the real rover, 29 000 on medium, 21 000 on low; its machines stop when the camera's far, and the whole place isn't drawn beyond the land's reach (`field*.ts`) |
| The keep | Made the way a carpenter would: decks, floors and tables of planks, a shingled roof, bevelled panels with seams, framed windows with sills, capped railing posts and balusters, a solar roof with cells, the giant tree's crown in heaps of small facets, the lab's limestone hill chipped and layered, its bench a worktop over drawers, stones along the paths (`keep.ts`) |
| The workshop | A steel-framed hall with a glazed sawtooth roof, lit by its own light (the sky through its glazing, the sun's patches through its real openings, lamp pools at night), that opens part by part for the camera; its machines are one skinned mesh moved by a simulation of the floor's work (see "The workshop" above; `hall*.ts`) |
| The distance | Three hazy lavender mountain ranges, and wind turbines and research domes at the horizon; nearer, a research station of panelled geodesic domes and a limestone cliff and arch in chipped layers (`scenery.ts`) |
| At night | Lit windows, lanterns, screens and runes glow warm or cool (`glows.ts`), and a few point lights by tier. Moonlight follows the moon's real phase and height: a full moon high in the south lights the land nearly twice as brightly as no moon at all, a half moon far less than half of that (the moon's face is brightest lit head-on), a moon low over the hills less and warmer; the clouds take its light too, and the air glows silver round it. With it down, the sky's own glow still lights the night enough to read (`daynight.ts`) |
| His heart | The lodestar on his chest beats: a uniform that brightens only the star (its glow mask's white-hot part), a soft lub-dub at rest and a strong beat for a few seconds when a heartbeat runs (`care.ts`' `lodestarPulse`); steady under reduced motion |
| The camera | Close and low over his shoulder, so he's large in the frame. While he walks it swings slowly round behind him, to a side where nothing blocks the view and where its arm may put it (the following view asks by the arm's own rule: under the keep's crown isn't offered while he stands just outside it, as at the council table), turning there at a pace the eye can follow, never in one frame; turned by hand, it stays where it's turned for a while, until Follow is asked for again. It's a body on a spring arm: carried round with the arm as the view turns, zooms and follows him (so a turn moves it exactly as far as the turn does), then eased to where the arm wants it, never faster in all than the arm's end moves plus 12 m/s. The arm lifts over the land when a hillside rises behind (the proving ground's edge), keeps some room from what it passes and tilts up over something right by him. Every move slides among the solids (round a post, along a wall, over a roof), so it never jumps, by any input, and is never inside anything (a crown, a post, a machine, a wall) or under the land; it never goes under something he isn't under. Held against something it can't slide round on its way (a wall with the arm's end beyond it), it isn't carried on along it but makes for the arm on its own side, at the nearest place there it may stand (so it's never pressed for good into a corner beside him, as it once was against the council table's lantern); left behind, 4 m past its arm and getting nowhere for a second (on the keep's deck as he walks off down the stairs), it cuts to the arm, as it does when he jumps somewhere. Under reduced motion it goes straight where it may. Leaves, posts and walls between it and him aren't looked round: they dissolve in a fine dither (`camera.ts`, `occlusion.ts`). A dense test turns it by hand round the keep, every station, the hall and the proving ground's edge at five distances and holds the most it moves in a frame (`camera.test.ts`); `?trace=1` on the page keeps its last 2000 frames, and Galahad's, in `globalThis.__sandboxTrace` |
| His eyes | A second camera at his visor, turned by his head and then by his eyes, drawn into a small canvas of its own a few times a second while its panel is open, or as the main view (see "His eyes" above; `eyes.ts`) |
| What's solid | Everything walkers and the camera meet is one world of solids (`collide.ts`): the keep's and each station's footprints (`keep-plan.ts`, held to the drawn keep by a test), the sites' walls and their places' own solids and machines, each tree's trunk and crown and each rock (`flora-plan.ts`, added and dropped with their chunk), and each plot's fence with the gap for its gate, its sign and its dome (`plot-plan.ts`, which `plots.ts` draws from too). What can be stood on has its height: the keep's stairs (each tread, the landing) and deck, the rover course's bridge, flat-topped rocks; a walker steps onto a top within its step of its feet and is stopped by anything taller (`Solids.support`, `BUILDS`). The stairs are one plan (`keep-deck.ts`) that the keep draws them from and the solids are made of, and the test that holds the footprints to the drawing covers them and their rails. Galahad plans his way round it all and off the water (`nav.ts`: the blocked part of the way searched on a grid, pulled taut into a few straight legs; up to the deck by the stairs) and slides along whatever he meets on the way; the dog keeps by him where there's room and follows in his footsteps round what stands between, and sent somewhere it can't go straight to (its cushion, when they come down from the keep at night and it's behind the head of his bed) it asks his planner for the way round, once it's got no nearer for half a second; the Microducks and the animals that walk (deer, hares, foxes, ducks and swans: see "The ecosystem") slide along what they meet and keep apart, the small giving way to the large, everyone to a site's machines. Nothing tunnels, however fast he dashes. Walkers that end up overlapping are parted each frame, the lighter giving way: each is tried against those in the cells of a 4 m grid round it, not against every other, so a thousand animals cost what's near each (and end exactly where trying every pair would put them: a test holds the two to the same places). `?colliders=1` on the page draws it all as lines, coloured by what it stops, with every walker's circle |
| Labels | Laid out on the screen so none sits on another: in order of how much each matters (his bubble, the open experiment, the experiments, their bodies, the sites, the stations, the nodes; within each, the nearer first), each stands on its anchor if that's free, else just above what's in its way (at most three times its height), else fades. A margin it has to clear before it changes its mind keeps them still as the view moves; under reduced motion they don't animate. Sizes are measured when a label is shown or changes, not every frame; the layout allocates nothing (`labels.ts`) |
| Steadiness | Land and plants grow within a few milliseconds a frame, nearest first; a chunk's fine grid is grown in two steps (its samples, then its mesh), each within the same budget. So that every device makes progress, one grower may take a step past that budget each frame, the land one frame and the plants the next: a frame that grows is one step over at most. Plant instances live in pages, so a chunk uploads only its own and turning the view uploads nothing; rocks are written once, and only what has levels of detail (trees, bushes, reeds) changes pages as its level changes. The season and the wind upload nothing but a few uniforms. Shaders compile before the first frame, through the post pipeline too (every material again for its render target). Frames are paced to the display, shadows snap to texels, and labels ease onto device pixels after the camera moves |

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
| Heath | High, dry, open ground; the uplands | Dry olive in summer, mauve while the heather flowers, a pale russet through the autumn, grey-gold in winter | Heather underfoot and in mounds, gorse, a lone pine or birch |
| Woodland | Where the woods are, the damper and lower of them | A deeper green | Oaks, limes, parasol trees, a cherry, an alder; ferns, anemones in spring, fallen leaves, mushrooms, logs and stumps |
| Birchwood | The woods where their own noise runs low | A lighter green under thin crowns | Birches, an oak or two; ferns, anemones |
| Pinewood | The woods where it runs high, the ground is dry or a ridge is under them | Needles in the grass | Pines and spruces; ferns, heather, mushrooms |
| Outcrop | Crags, ridge crests, the tops above the rock line | Warm limestone | Boulders and slabs, a pine or a birch, thyme |
| Lawn | The kept ground of the keep, the sites and the plots | Mown green, worn by the paths | Grass and flowers on the keep's lawn; nothing where something is built |

A biome is a share, not a line: the shares sum to 1 and change over some tens of metres. The ground's colour is mixed by them, and each thing that grows takes one of the biomes there by its share, so at an edge the two sides stand mixed. `biomeAt(seed, x, y, flats)` names the biome with the most of a point; `biomeMix` gives the shares, `moistureAt` the moisture, `climateAt` all of it. All pure, and allocation-free when given what to write into. A chunk samples its climate once, at its base grid's corners (its slowest noises at every fourth), and its faces and its growth read it from there. Every triangle of the ground keeps its biomes' shares: what's big (a tree, a rock, a stand of reeds) takes its biome from the land's own climate where it stands, and what's small from the triangle under it, so a flower is of the ground it stands on.

### What grows

Every model is original and procedural (`flora-models.ts`), one merged geometry and one instanced mesh each, drawn only while a chunk in reach grows some:

| Layer | Kinds | Where it's drawn |
|---|---|---|
| Trees | Oak, pine, round, parasol, birch (banded white bark), cherry, spruce (a spire, darker and bluer than a pine), alder (upright, dark-barked), willow (a dome with curtains hanging round its rim) | Out to the land's reach, in three levels of detail: near (`treeDetail` metres, none on the low tier) crowns are heaps of many small facets on tapering trunks with root flares; farther (`treeLod`), simpler; far off, a few facets (five far models on the high tier: broad, birch, pine, spruce, cherry; two below it, where a far spruce is a far pine and a far birch or cherry any broad tree, a round tree and an alder are oaks at every distance, and spruces and willows have no near model of their own) |
| Bushes | Leafy, in flower, ferns, gorse (a leafy bush below the high tier), mounds of heather | Out to the land's reach; a leafy bush far off is two heaps of leaves |
| Rocks and deadwood | Boulders, stones, layered slabs with chipped facets (gathering on crags); in the woods fallen logs, each by the stump it broke from | Out to the land's reach |
| Reeds | Reeds with plumes and cattails among them; stands of rushes on the wet ground (drawn as reeds below the high tier) | Out to the land's reach; far off, a few broad strokes (the medium tier draws the reeds themselves at every distance, the low tier the strokes: one model each) |
| Flowers | Daisies with buttercups; lupines, campions and lavender; wood anemones; heather | Near the camera (`grassRadius`) |
| Grass | Tufts, lush clumps gone to seed, marram (which, smaller and darker, is the marsh's tussock too; below the high tier both are tufts of another size and colour) | Near the camera |
| Underfoot | Pebbles, clover, mushrooms, fallen leaves, driftwood (high tier), lily pads (afloat: they ride the water's waves; not on the low tier) | Near the camera |

A crown or a bush within two and a half metres of the camera dissolves in a fine dither (a full one would fill the view with green, a thinning one with a few great leaves), as whatever would hide Galahad does. Trees and rocks are solid, as their models are (`flora-plan.ts`, held to the models by a test): a trunk walkers go round, a crown the camera keeps out of, a skirt where a crown hangs low; a log and its stump are low enough to see over, and a low one he steps onto. A model is a draw call, and a phone pays for each: kinds that are always together are one model (a log and its stump, reeds and their cattails, a patch of daisies and buttercups), the lower tiers have fewer models (above), and there a small thing of which only a handful is in reach isn't drawn at all. Bushes, reeds and the small things aren't. Nothing grows where something is built, in a stream's pool, or (the solid things) on the trail he and the dog walk.

### The seasons

The season is Denmark's, by the real date (`season.ts`): not four switches but a year that turns. What grows reads it as a few amounts (`flora-season.ts`): how far the leaves are out and how far turned, what's in flower, how pale the grass is, how many leaves lie on the ground. Each part of each model says which amount grows it and which one colours it, the point it grows from and its place in the queue; the vertex shader does the rest, each plant a little ahead of or behind its neighbours (`flora-shade.ts`). So a crown thins leaf by leaf, a meadow comes into flower patch by patch, and nothing pops; a kind whose season is over (anemones in summer, the meadows' flowers in winter) isn't drawn at all.

The keep's great tree keeps the season with the rest (`keep.ts`): each facet of its crown is its own leaf-mass, turning gold and rust one by one in autumn and most coming down; what it holds through the winter is brown (an oak keeps some of its leaves), and in spring it's thin and fresh until it fills. The HUD's sky panel has the Season control: live is Denmark's by the real date, or any season to look at (`flora-shade.ts` keeps `seasonState` to it and eases what grows).

| When | What you see |
|---|---|
| Spring | Buds swelling on every twig at once; blossom on the cherries for a few weeks of April and May; wood anemones white under the bare woods, gone by June; daisies from March; fresh, lighter green |
| Summer | Full lime crowns; the meadows in flower from late April to September; lily pads in flower on the still water |
| Late August | The heather flowers: the heaths go mauve, their mounds and sprigs purple |
| Autumn | Crowns turn leaf by leaf to gold, amber and coral (birches yellow first; alders and willows late and only half; conifers never) and thin as the leaves fall, one after another (those still there smaller the fewer are left), so their limbs and fine twigs show through; leaves come down in the wind from the crowns nearest the view, and lie under the deciduous trees (strewn leaves near the camera, and a mottling of the wood's floor that leaves the grass showing); mushrooms come up; ferns go bracken-brown (and stay so until the new fronds); grass yellows; reeds go to straw |
| Winter | Bare crowns: long tapering limbs and a haze of twigs (a birch's dark on its white trunk, a willow's golden); conifers a little deeper; grass a pale sage; reeds and marshes straw; the last leaves on the ground a pale buff. Snow, when the weather brings it, lies on whatever faces up: limbs, boughs, the tiers of the spruces |

A turned leaf lets the sky's light through (its shaded side glows a little by day, not at night), and a thinning crown is drawn from both sides, so its last leaves are seen from under it. The colours are pastel on purpose: light and towards yellow in autumn (a shaded orange is a brown), green all winter, never mud.

With `?trace=1`, `globalThis.__sandboxSeason("spring" | "summer" | "autumn" | "winter" | "live")` looks at a season (or a number, 0 to 1, at that point of the year: 0.65 is late August), eased over a couple of seconds, and `__sandboxStats()` says what's drawn; `__sandboxLook(x, y, distance, yaw)` puts the view somewhere.

### The wind in what grows

Gusts cross the land as waves that travel the way the weather's wind blows, at its speed: a broad front every 26 m or so, bent by a slow cross-wave so it's never ruled, with a finer ripple on it. Every blade, reed and crown leans downwind, more as a front passes over it and less behind it, and brightens a little as it bends (the pale undersides of leaves, the sheen of bent grass). The land's own grass shimmers with the same waves, so they're seen crossing a meadow far beyond where its blades are drawn. In a light breeze it's a slow swell every eight seconds or so; in a gale the fronts race. Under reduced motion nothing moves.

## How far it scales

How much world a device carries isn't argued here, it's measured: `bench/browser/world-scale.ts` starts a throwaway node, opens the SANDBOX in headless Edge and measures it scene by scene (see "Measuring it" below). What follows is what it found on one machine in November 2026 (an eight-core desktop CPU with a workstation GPU, Windows, Edge with WebGPU; WebGL2 forced for the fallback), what was changed because of it, and what wasn't.

**No phone was measured.** "Phone" below is a phone's size and pixel ratio (390 × 844 at 3, touch) in that desktop browser on the low and medium tiers, and "a slow phone's CPU" is the same with the CPU slowed four times. The GPU is a desktop's throughout: what a phone's GPU makes of the picture is not known here.

**The machine was shared while it ran**, and a busy machine runs a page at half speed. So every time on the CPU's clock is scaled to the machine's best speed by a small fixed loop run on the page's own thread round each window, a part's cost is measured turn about with the whole picture, seconds apart, and the spread is given where it matters. A time without a spread is good to about a fifth; two runs an hour apart can't show a difference of a tenth, pairs seconds apart can. Counts (objects, triangles, animals) are exact.

### What limited it

The main thread, in the renderer: handing three.js the objects to draw. Not the GPU, not the ecosystem's simulation, not the land.

| As it was (the view from high over the keep, a summer's day, clear) | low (phone) | medium (phone) | high (desktop) |
|---|---|---|---|
| The main thread's time a frame: median, 95th percentile | 2.2, 2.7 ms | 2.6, 3.2 ms | 5.2, 6.0 ms (5.6, 8.0 the one time the machine was quiet) |
| Of that, in the renderer | 1.5 ms | 1.7 ms | 3.9 ms |
| The same on a CPU four times slower: median, 95th percentile | 10.5, 15.7 ms | 12.0, 16.6 ms | |
| The GPU's time a frame (WebGPU timestamp queries) | 0.3 ms | 0.7 ms | 1.3 ms |
| Objects handed to the renderer a frame, all passes | 105 | 113 | 251 |
| Triangles a frame, all passes | 0.59 M | 1.11 M | 2.64 M |
| JS heap; vertex data held for the GPU | 24, 28 MB | 27, 40 MB | 33, 56 MB |
| On WebGL2 instead: the main thread's median | 2.5 ms | 2.5 ms | 5.0 ms |

- **Where the main thread's time went** (a sampled profile of the high tier, by function): half in the scene's own passes, a sixth in the sun's shadow pass, a third outside the renderer. By the kind of work: three.js checking and writing each object's uniforms and bindings 17 %; the world's own code (his day, the rigs, the ecosystem, the machines, the labels) 17 %; the browser's own (the GPU commands crossing to its GPU process) 14 %; the renderer's draw loop 11 %; issuing the draw commands 10 %; its pipeline and cache checks an object 9 %; beginning, ending and submitting passes 8 %; checking vertex data 6 %; culling and sorting 5 %; matrices 3 %. So about 16 µs of main-thread time for each object in each pass, whatever is in it, and the world handed over 251 of them. The medium and low tiers have no shadow pass and no post effects; the shares of the rest are the same.
- **What each part cost** (taken away and put back, six pairs each, the high tier): the post effects 1.2 ms for 16 passes (the dearest by the object: each pass is begun, bound and submitted on its own); the plants 0.9 ms (60 objects, 1.4 M triangles, 0.9 ms of the GPU's time); the robots 0.8 ms (72 objects: see below); the wildlife 0.7 ms (20); the keep and the built places 0.7 ms (34); the sun's shadow pass 0.6 ms (72 objects drawn again); the land 0.1 ms (31 chunks in view of 93 grown); Galahad and his dog 0.06 ms. On the medium tier: the plants 0.5 ms (28 objects), the robots 0.2 to 0.4 ms (37), the land 0.1 ms (15), the wildlife under 0.1 ms. (Each ± 0.3 to 0.6 ms: they say which parts are dear, not their order to the tenth.)
- **The ecosystem** cost 0.15 ms a frame on the high tier with its own animals (0.1 ms on medium): the simulation is not what a frame waits for.
- **The GPU** (this one) has room: 1.3 ms a frame on the high tier at 0.64 megapixels. Its time grows by 0.2 to 0.3 ms a megapixel (the high tier at 6.1 megapixels, a 1920 × 1080 window at a pixel ratio of 2: 3.1 ms; at 0.4: 1.5 to 1.8 ms), so about 1.5 ms of it is geometry and passes and the rest is shading; on the medium tier 0.45 ms and about the same a megapixel. A phone's GPU is several times slower: by these sums the medium tier's picture would still fit a 60 Hz frame on one five times slower, but that is a sum, not a measurement. (On WebGL2 the browser's own timer says 2.5 to 8 ms where WebGPU's says 0.3 to 1.3: it counts more than the passes, and the frames came no slower.)
- **Memory**: 24 to 34 MB of JS heap and 28 to 57 MB of vertex data by tier. The browser's GPU process held 290 to 470 MB of dedicated memory with the world open at these sizes, and 1.3 GB with the high tier at 6.1 megapixels (multisampling and the post effects' targets grow with the pixels). That count is the whole GPU process's, as Windows gives it, and it isn't given back at once between loads: read it as an order of size.
- **The bundle**: `world.js` was 1,787 KB, 580 KB gzipped, 528 KB with Brotli (three.js and the whole world). It's 1,807 KB, 586 KB and 533 KB now.

### Starting, and the frames that stall

| From navigation, a browser that hasn't drawn this tier before | low | medium | high |
|---|---|---|---|
| The GPU ready | 0.2 s | 0.25 s | 0.3 s |
| Every shader compiled | 1.2 s | 1.8 s | 2.2 s |
| The first frame | 1.3 s | 1.9 s | 2.4 s |
| Nothing left to grow | 1.5 s | 2.3 s | 3.0 s |
| On WebGL2: the first frame | 3.4 s | 3.9 s | 6.8 s |

Compiling is most of a start (a browser that has drawn the tier before keeps its shaders: the same loads then took 1.4 to 1.6 s to the first frame). WebGL2 compiles in the frame that first draws something: its first frame took 1.5, 2.1 and 4.2 s of main-thread time on the three tiers, and a few more of a quarter to half a second followed.

- **The first frame** is long everywhere: 90 to 220 ms (buffers made, the first of everything).
- **Growing land** takes 4 to 11 ms of a frame while the view flies over fresh country at 30 m/s (low 3.6 to 5.2 ms at the median and 7.3 at most, medium 5.4 to 6.3 and 8.5, high 9.4 to 10.6 and 12.7): inside a 60 Hz frame here, about one of them on a CPU four times slower. While a world loads, the frames that grow it take 5 to 14 ms at the median.
- **The robots arriving** (their models are fetched after the first frame) stall a frame or two for 40 to 100 ms each at 60 Hz, as their pipelines are made.
- **A season looked at from the sky panel stalls the high tier for one to two and a half seconds**, once, as the leaves' amounts cross the point where crowns are drawn from both sides: every tree's and bush's pipeline is made again in that frame, for the scene's pass, the shadow's and the post effects'. On the medium tier the same frame is 0.1 to 0.3 s. It happens when a season is previewed (and twice a year by the date); it was found because the benchmark looks at summer in November. Not fixed: see "What wasn't done".

### The curves

Each tier asked for more of one thing, the rest as it is: the 95th percentile of the interval between frames with the browser's frame-rate limit off (the whole pipeline, CPU and GPU), in milliseconds. 16.7 is 60 frames a second, 33.3 is 30.

**Animals**, at a spring dusk with the starlings up, when the most are about (who's alive in brackets). Before, and after the walkers' parting was changed (below):

| The tier's animals, times | low before | low after | medium before | medium after | high before | high after |
|---|---|---|---|---|---|---|
| 1 | 4.0 (40) | 3.6 (40) | 4.3 (110) | 3.7 (107) | 7.5 (242) | 7.9 (235) |
| 4 | 3.9 (160) | 3.0 (153) | 4.6 (371) | 4.4 (349) | 9.2 (565) | 8.0 (567) |
| 16 | 4.5 (525) | 3.6 (491) | 7.6 (757) | 4.4 (680) | 29.8 (1,353) | 9.5 (1,320) |
| 64 | 13.4 (1,386) | 4.5 (1,100) | 45.3 (2,160) | 14.1 (2,514) | 96.9 (2,720) | 14.2 (4,772) |
| 256 | | 8.8 (3,870) | | 30.7 (5,456) | | 68.3 (16,137) |
| Leaves 60 frames a second at | past 64 | past 256 | 22 times (about 900 animals) | 80 times (about 2,800) | 7 times (about 750) | 68 times (about 5,000) |
| Leaves 30 at | past 64 | past 256 | 41 times | past 256 | 17 times | 104 times |

What gives out now, at thousands of animals, is the ecosystem's own step (7.6 ms of an 11 ms frame at 64 times on the medium tier; 27 ms at 256 times on high), not the drawing: the objects handed to the renderer don't grow with the animals (one a kind), and the GPU's time went from 2.0 to 6.9 ms for twenty times the animals.

**The land's reach and the plants** (as it is now; the reach's caps grow with its area, the plants are the small ones and the near trees over that many times the area):

| | low | medium | high |
|---|---|---|---|
| The reach as it is: frame; chunks grown; triangles; vertex data | 3.2; 50; 0.59 M; 28 MB | 3.4; 81; 1.11 M; 40 MB | 6.8; 93; 2.67 M; 56 MB |
| Twice the reach | 3.5; 96; 0.79 M; 34 MB | 3.7; 172; 1.55 M; 51 MB | 6.9; 296; 3.98 M; 82 MB |
| Three times | 3.1; 197; 1.19 M; 44 MB | 4.0; 356; 2.39 M; 72 MB | 7.6; 640; 6.30 M; 124 MB |
| The GPU's time, from the reach as it is to three times | 0.4 to 0.6 ms | 0.7 to 1.1 ms | 1.5 to 2.9 ms |
| The plants as they are: frame; triangles; GPU | 3.6; 0.58 M; 0.4 ms | 3.8; 1.11 M; 0.7 ms | 7.5; 2.67 M; 1.7 ms |
| Four times the plants | 3.9; 0.88 M; 0.6 ms | 3.8; 1.75 M; 0.9 ms | 7.4; 4.88 M; 2.3 ms |
| Eight times | 3.3; 1.08 M; 0.7 ms | 4.0; 2.38 M; 1.5 ms | 6.8; 6.46 M; 3.2 ms |

Neither takes a tier out of 60 frames a second here. More land and more plants cost memory and the GPU's time, hardly the main thread's (a chunk out of view isn't handed over; a kind of plant is one object however many there are): three times the reach is two and a quarter times the vertex data on the high tier, twice the GPU's time, and four seconds to a settled world instead of two.

**Everything else that was asked for** moves a frame by less than the measurements can tell apart, on every tier: night (lamps and glows: 9 objects more), rain, snow and a storm; six helpers and six agents beside him (9 to 18 objects more); the sound on while he walks in rain (4.3 ms a frame against 4.2); his day, the view following him close (asleep, on his walk, at fetch with the dog, at the forge, by day and by night: 4.1 to 5.5 ms on the high tier, 2.3 to 3.0 on medium, never more than the wide view). His eyes' panel, open, adds 0.2 ms a frame averaged on the high tier (0.3 on WebGL2, where his view is a full-size render) and shows in the 95th percentile, the frames that draw it: 7.3 to 8.0 ms (5.7 to 7.5 on WebGL2). Experiments on their plots are the exception worth knowing: each body is an object, and again in the shadow pass, so four experiments of twelve bodies were 58 objects more on the high tier and twelve were 143 more, about 2 ms of main thread by the 16 µs above.

### Would a real game engine carry more?

The question was asked, and it's a fair one: three.js is a renderer, and what an engine gives beside one (scene management, culling, levels of detail, instancing, streaming, an entity system, a job system) is hand-built here or missing. It was put to the numbers, with a threshold set before any engine was measured: **moving is worth it only if a candidate gives at least twice the headroom on the phone tier, for what really limits that tier, at a cost of porting that can be defended** (53,000 lines and 43 test files live in this world), with a fallback as good as today's (WebGPU, and WebGL2 where there's none, in Safari on an iPhone) and without making the app's pages cross-origin isolated.

| | Runs in this PWA on an iPhone and a desktop | Download | A world made wholly by code, with shaders like these | For what limits this world | Threads | Licence; alive? | Porting |
|---|---|---|---|---|---|---|---|
| **three.js 0.187** (stay) | Yes: WebGPU, WebGL2 where there's none (it's what runs today). Safari has WebGPU from iOS 26 | The slice below: 846 KB minified, 186 KB Brotli. The whole world today: 533 KB Brotli | Node materials (TSL): one source for both backends, which is how every material here is written | The cost is its own: 11 µs an object on the slice. `BundleGroup` (WebGPU render bundles) records what doesn't change and replays it; `BatchedMesh` draws many geometries as one object | None in the engine; workers are the app's to add, and need no isolation unless memory is shared | MIT; 0.187.0 is the newest release (October 2026) | None |
| **Babylon.js 9.36** | Yes: WebGPU ("complete … besides a few exceptions"), WebGL2 | 2,038 KB minified, 361 KB Brotli for the slice: twice three's | Yes, by material plugins or its node material; a plugin's shader code is written twice, WGSL and GLSL (the slice's is) | Snapshot rendering (WebGPU only) records a frame's draw calls and replays them: its gain is "on the JavaScript side only". Meshes can't be added or removed without recording again; in its fast mode only the scene's own uniforms change | None in the engine | Apache-2.0; 9.0 in March 2026, 9.36 in November | Everything that draws: every material, mesh and light, the post effects, the second view. The simulation, the plans and the pure parts would stay |
| **PlayCanvas engine 2.24** | Yes: WebGPU, WebGL2 | 1,483 KB minified, 284 KB Brotli for the slice | Its standard material's shader chunks are overridden, each written twice, GLSL and WGSL; there's no node graph to write one source in. No hemisphere light; an instance has a matrix and nothing else unless the instancing format and chunk are replaced | The leanest draw path of the three at many objects (below). Instances aren't culled; on WebGPU its clustered lighting can't be turned off | None in the engine | MIT; 2.24.1 in November 2026 | As Babylon's, and every shader here written twice |
| **Godot 4 (web export)** | WebGL2 only: "Godot 4 can only target WebGL 2.0 (using the Compatibility rendering method)", "Godot currently does not support WebGPU"; its docs warn of Safari's WebGL2 | About 40 MB of WebAssembly, 5 MB with Brotli, before the world | A world in GDScript and Godot's shading language (C# isn't exported to the web): a rewrite of the simulation too, and of its tests | Not measured | Threads need `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; single-threaded is its default on the web | MIT; alive | Everything, tests included |
| **Bevy 0.20 (WebAssembly)** | One or the other: its `webgpu` feature overrides `webgl2`, and such a build doesn't run where there's no WebGPU; WebGPU support is "currently experimental". Two builds for a fallback | Its own figures for a small project: 4.8 to 13 MB of WebAssembly | A world in Rust and WGSL: a rewrite of everything | Not measured | Single-threaded in the browser; its command line's multi-threading is experimental, needs cross-origin isolation, and Safari can't spawn its nested workers | MIT or Apache-2.0; 0.20 in October 2026 | Everything, tests included |

(From the engines' own documentation and release notes and the npm registry, read in November 2026: three.js's `BundleGroup` page; Babylon.js's "Snapshot rendering" and "WebGPU status" pages; PlayCanvas's "Hardware instancing" manual page; Godot's "Exporting for the Web" and its "Web export in 4.3" progress report; Bevy's news page, its examples' README on Wasm and its CLI's page on web multi-threading; web.dev's "WebGPU is now supported in major browsers" for Safari 26.)

Godot and Bevy fail the criteria before any measuring (no WebGPU with a fallback in one build, ten times the download, a rewrite of the simulation and its tests), so they weren't built. Cross-origin isolation, which their threads would need, means the node sending those two headers on the app's pages; the app loads nothing from another origin (its own content security policy forbids it), so little would break, but a window opened from the app could no longer talk to the page that opened it. Nothing here needs it: a worker that's handed its buffers (transferred, not shared) works without.

The two that could plausibly win were built and measured: **the same slice of a generated world** (25 chunks of faceted land; 24 kinds of plants, 500 of each, instanced, swaying in the vertex shader; 8 kinds of animals, 50 of each, every instance written each frame, legs swung in the vertex shader; one skinned figure of 23 bones; a sun with a 2048² shadow map, a sky light, fog), from the same numbers, in three.js as this world is built, in Babylon.js and in PlayCanvas, each the way that engine would have it, and at three times the chunks and kinds. Same machine, same browser, same loop and clock as the world's own benchmark; every engine and mode measured once a round for three rounds, the median given with half the rounds' range. The code is in `spikes/engines/` (nothing imports it, the node never bundles it, its dependencies and lockfile are its own).

| The main thread's time a frame | 72 objects a frame | 186 objects a frame | So an object costs | First frame | JS heap |
|---|---|---|---|---|---|
| three.js 0.187, WebGPU | 0.54 ms ± 0.02 | 1.84 ms ± 0.12 | 11 µs | 0.6 to 0.7 s | 6 to 7 MB |
| … the land and the plants in a render bundle | 0.55 ± 0.08 | 1.77 ± 0.09 | 11 µs | | |
| three.js, WebGL2 | 0.49 ± 0.02 | 1.36 ± 0.04 | 8 µs | 0.8 s | |
| Babylon.js 9.36, WebGPU | 0.71 ± 0.05 | 1.68 ± 0.17 | 8 µs | 0.75 s | 10 to 12 MB |
| … snapshot rendering, standard | 0.73 ± 0.09 | 1.84 ± 0.08 | 10 µs | | |
| … snapshot rendering, fast (the sway and the figure's bones don't move in it) | 0.43 ± 0.17 | 1.64 ± 0.12 | 10 µs | | |
| Babylon.js, WebGL2 | 0.42 ± 0.03 | 1.39 ± 0.35 | 8 µs | 0.7 to 1.1 s | |
| PlayCanvas 2.24, WebGPU | 0.75 ± 0.01 | 1.21 ± 0.03 | 4 µs, on 0.5 ms a frame before any | 0.4 to 0.5 s | 8 to 9 MB |
| PlayCanvas, WebGL2 | 0.33 ± 0.02 | 1.13 ± 0.33 | 7 µs | 0.55 to 0.7 s | |

- At the phone tier's count of objects (85 a frame now), three.js is as fast as either: 0.54 ms against 0.71 and 0.75 at 72 objects. PlayCanvas pays half a millisecond a frame before it draws anything on WebGPU and gets it back only past a hundred objects.
- At the high tier's count (about 200), PlayCanvas's WebGPU path is one and a half times faster on the main thread (1.21 ms against 1.84), and Babylon.js's is three.js's within the spread. On WebGL2 the three are within the spread of each other.
- Recording a frame and replaying it (three.js's render bundles, Babylon.js's snapshot rendering) bought nothing here that can be told from the spread: with node materials every object's uniforms are checked each frame either way, and that is most of an object's cost. (A first, single measurement on a busier machine had them a third faster; three rounds didn't.)

**So: stay, and build.** No candidate comes near twice the headroom on the phone tier: there is none to be had there, and on the high tier the best of them would take a frame's main-thread time from about 4.4 ms to somewhere between 3.3 and 3.7 ms (the renderer's share of it one and a half times faster, or its 4 µs an object for three.js's 11 with its half millisecond first) if every material here were written again, twice, in its shader chunks. What's fastest is so by the means that are open here without a port: handing the renderer fewer objects. The first change below took a quarter of the phone tier's objects away in one file. What would change the answer: a real phone showing that it's the GPU that limits it (then no engine helps: the shading is the picture's), or a world of a thousand objects and more a frame that batching here can't bring down, where PlayCanvas's 4 µs an object against 11 would be worth a port's cost.

### What was changed

Each measured before and after with the benchmark; nothing the world shows was taken away, on any tier.

| | Before | After |
|---|---|---|
| **The robots are one object a kind** (`robots/load.ts`: three's `BatchedMesh`; they were one instanced mesh a link, and each again in the shadow pass) | 251 objects a frame on the high tier, 113 on medium, 105 on low; the robots cost the main thread 0.8 to 0.9 ms a frame on high (± 0.4 to 0.7), 0.2 to 0.4 ms on medium (± 0.1 to 0.3), in two sets of pairs | 199, 87 and 79 objects (a fifth, and a quarter on the phone tiers, fewer). The robots' cost in two sets of pairs: 0.03 ms (± 0.13) and 0.01 (± 0.44) on medium, which can't be told from nothing; 0.01 (± 0.36) and 0.7 (± 1.1) on high, too wide to say more than the count does (52 objects fewer, at the 11 to 16 µs an object costs, is 0.6 to 0.8 ms) |
| **Walkers are parted by who's near them** (`collide.ts`' `separate`: a 4 m grid; it tried every pair, every frame) | Asked for 16 times the animals, his part of the frame (the parting is in it) was 6.4 ms on the high tier and 1.9 on medium; for 64 times, 65 and 21 ms: where the animals' curve broke. 3,000 movers: 59 ms a pass | The same places, exactly (a test holds the two ways to them, crowd after crowd). 0.6 ms and 0.3 ms at 16 times, 2.1 and 1.6 ms at 64 times. 3,000 movers: 2.8 ms a pass. The curve above: 60 frames a second held to about 5,000 animals on the high tier where it was 750, to 2,800 on medium where it was 900 |
| **A frame that grows is one step over its budget at most** (`land.ts`, `vegetation.ts`: the land, its fine grid and its plants each took a step past the budget if they had to; now one of them may, turn about) | While a world loads, the 95th percentile of the frames that grow land: 19 to 54 ms over six loads (the median of them 42) | 19 to 36 ms (27). While the view flies over fresh land, no difference that can be told: those frames were inside the budget already (5 to 11 ms) |
| **The ecosystem's range and numbers, wider** (`tiers.ts`: 100, 115 and 130 m round the view became 110, 130 and 160 m, with a fifth, a quarter and a half more animals: about the same to the hectare, over more ground) | 24, 58 and 92 animals on a summer's day in the ecosystem's own test (low, medium, high), 43, 96 and 223 at a spring dusk; its step and pose 16 to 28, 26 to 46 and 35 to 89 µs a frame | 20, 70 and 160, and 54, 135 and 337; 13 to 39, 26 to 59 and 49 to 122 µs, inside the 60, 110 and 200 the tests hold it to. In the page: 0.07, 0.11 and 0.22 ms a frame |

| As it is (the same view, the wider ranges, the machine nearly quiet: 0.83 to 0.91 of its best) | low (phone) | medium (phone) | high (desktop) |
|---|---|---|---|
| The main thread's time a frame: median, 95th percentile | 1.9, 2.6 ms | 2.4, 3.0 ms | 4.4, 6.0 ms |
| Of that, in the renderer | 1.2 ms | 1.5 ms | 3.3 ms |
| The same on a CPU four times slower: median, 95th percentile | 7.4, 9.8 ms | 8.0, 10.4 ms | |
| Objects handed to the renderer a frame, all passes | 79 | 85 | 198 |
| Animals alive in the range on a summer's day; insects | 27; 24 | 45; 76 | 179; 210 |

**What each tier can carry now that it couldn't.** By the animals' curve, the high tier holds 60 frames a second to about 5,000 animals where it held it to about 750, and the medium tier to about 2,800 where it was 900: the tiers' own numbers (a few hundred at most) are a fiftieth of that, which is why the ranges could be widened for a tenth of a millisecond. On a CPU four times slower the phone tiers' 95th percentile frame is 10 ms where it was 16 to 17: inside a 60 Hz frame with room, where it was at its edge. (Those two were measured an hour apart on a shared machine, so the size of that difference is good to a fifth; the quarter fewer objects behind it is exact.) The land's reach and the plants were left as they are: the curves say three times the reach and eight times the plants still hold 60 frames a second here, but they cost memory and the GPU's time, which no phone has been asked about, and how far the land is drawn is a matter of how the world looks (the fog, the far hills). That choice is the owner's, with these numbers.

### What wasn't done, and why

- **The ecosystem in a worker.** Its simulation costs 0.2 ms a frame; at sixteen times the animals, 1 to 3 ms. What broke the curve was the walkers' parting, which is fixed where it is. A worker would add a frame of delay to everything the animals notice, for a fifth of a millisecond today. Past a few thousand animals its own step is what gives out (something in it grows faster than the animals do): that's where to look next, before a worker.
- **The land grown in a worker.** A frame that grows land takes 4 to 11 ms here: inside a 60 Hz frame. Of a chunk's cost, its pure sums (the surface, its fine grid, its small plants) are about 3.5 ms; the rest is making its buffers and filling its instances, which only the main thread can do. On a CPU four times slower a growing frame would be about 30 ms: worth doing if a real phone shows it.
- **The land and the plants batched.** They are what's left of the objects (about 90 of 199 on the high tier, 40 of 87 on medium). Render bundles bought nothing that could be told on the slice, and what's recorded can't be culled, so every chunk grown would be drawn. A batched land (one object, as the robots are now) is the gain, and a rewrite of how chunks swap grids and plants swap pages: the next thing to do, not a small one. The experiments' bodies (an object each, and again in the shadow pass) are the same kind of work and smaller.
- **The post effects' passes.** 16 passes for about a millisecond of main thread on the high tier, most of them the bloom's mip chain, which is three.js's own node. Left as it is.
- **The season's stall.** The crowns' two-sidedness should be a second material made ready ahead, not a change that makes every pipeline again in one frame. Not done: it needs the renderer's asynchronous compile for the shadow's and the post effects' passes too, and a way to measure it that isn't a two-second freeze.
- **The robots' pipelines made ahead** (three's asynchronous compile, before they step in): tried, measured at 60 Hz, 41 to 100 ms a stall before and 36 to 63 ms after. Not worth its code; taken out.
- **A resolution that adapts.** It's there (the governor), and held off while measuring. Nothing here says it needs changing.

### Measuring it

```sh
bun bench/browser/world-scale.ts            # the quick matrix: each tier, the ends of each curve, a part's cost
bun bench/browser/world-scale.ts --full     # every tier, backend and screen; the curves until they break; his day
```

It needs a GPU and a browser to drive (it measures the browser it's given): `EDGE` or `GALAHAD_BROWSER` names one, else it uses Edge or Chrome where the platform keeps them. The numbers here are from Windows and Edge. `--only=<regex>` picks loads, `--shots=<dir>` keeps a picture of every scene, `--profile` samples the main thread, `--looks=name:x,y,distance,yaw` adds a view. Results go to `bench/out/world-scale.json` in the scorecard's shape, and everything measured to `world-scale.raw.json` beside it. The full matrix took an hour and a half on the shared machine.

On the page, `?trace=1` takes more beside `tier=` and `webgl=1` (`apps/web/src/world/bench.ts`): `animals=16`, `reach=2` and `plants=4` ask for that many times the tier's (the caps with them), `uncap=1` draws every frame the browser offers, `gpu=1` puts timestamp queries round every pass, `hold=1` keeps the resolution governor off. `globalThis.__sandboxBench` then has the last frames' times part by part (`stats()`), what's drawn (`drawn()`: draw calls, objects, triangles, who's alive), the vertex data held (`memory()`), when the world started and settled (`timing`), and switches for a tour: `time("day")`, `weather("rain")`, `shadows(false)`, `post({...})`, `dpr(1.5)`, `hide("plants", true)`.

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
