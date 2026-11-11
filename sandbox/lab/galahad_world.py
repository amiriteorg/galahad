"""galahad_world: show a simulation in Galahad's SANDBOX, live.

    import galahad_world as gw

    with gw.experiment("Pendulum", engine="custom", scene=[gw.box("base", 0.4, 0.4, 0.1, fixed=True), gw.sphere("bob", 0.1, trail=True)]) as ex:
        for t, (x, y, z) in trajectory:
            ex.frame(t, {"bob": (x, y, z, 1, 0, 0, 0)}, metrics={"energy_j": e})

Ready-made: gw.mujoco_run(model) for any MuJoCo model, gw.gazebo_run(sdf) for a Gazebo
world (in the Gazebo image), gw.jsbsim_fly() for an aircraft (JSBSim),
gw.rocketpy_play(flight) for a RocketPy flight, and gw.demo_arm(), gw.demo_gazebo(),
gw.demo_plane(), gw.demo_rocket().

Coordinates are metres, z up (x east, y north); orientations are unit quaternions
(w, x, y, z). Frames are paced to `speed` times real time so the world shows the
motion as it happened (speed=0: as fast as it computes).

An experiment has phases, and the module says them (`ex.phase`): building from the
moment it starts (Galahad puts it together at the workshop's bench), testing from
its first frame (where it belongs: a pad of the proving ground, a test cell, open
land), examining once it ends (at the observatory). While someone watches the
world, the node asks for the first frame to wait a few seconds (at most 30) while
it's shown being built; with nobody watching it doesn't wait. The script that
runs it (`__main__`, up to 64 KB) is kept with it on the node. A node that doesn't
know phases is spoken to as before.

Inside a Galahad sandbox with a network it streams to the node (GALAHAD_WORLD,
GALAHAD_TOKEN); anywhere else the simulation still runs, unseen. Standard library
only; numpy and the simulators are needed only by their adapters.
"""

import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

__all__ = [
    "experiment", "Experiment", "box", "sphere", "capsule", "cylinder", "plane", "mesh", "aircraft", "rocket",
    "quat_from_euler", "quat_multiply", "mujoco_scene", "mujoco_poses", "mujoco_run", "jsbsim_fly", "rocketpy_play",
    "gazebo_scene", "gazebo_run", "demo_arm", "demo_plane", "demo_rocket", "demo_gazebo",
]


def _say(text):
    print(f"galahad_world: {text}", file=sys.stderr, flush=True)


def _post(path, body, headers):
    data = json.dumps(body, separators=(",", ":"), allow_nan=False).encode()
    request = urllib.request.Request(
        os.environ["GALAHAD_WORLD"].rstrip("/") + path,
        data=data,
        headers={"content-type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            reason = json.loads(error.read()).get("error", "")
        except Exception:
            reason = ""
        raise RuntimeError(f"{error.code} {reason}".strip()) from None


# ---------- shapes (metres, local frame, z up) ----------

def _body(id, shape, color=None, fixed=False, label=None, trail=False):
    body = {"id": str(id), "shape": shape}
    if color:
        body["color"] = color
    if fixed:
        body["fixed"] = True
    if label:
        body["label"] = str(label)[:60]
    if trail:
        body["trail"] = True
    return body


def box(id, sx, sy, sz, **kw):
    """A box of full side lengths sx, sy, sz."""
    return _body(id, {"kind": "box", "size": [float(sx), float(sy), float(sz)]}, **kw)


def sphere(id, radius, **kw):
    return _body(id, {"kind": "sphere", "radius": float(radius)}, **kw)


def capsule(id, radius, length, **kw):
    """A capsule along local z; `length` is the straight part between the caps."""
    return _body(id, {"kind": "capsule", "radius": float(radius), "length": float(length)}, **kw)


def cylinder(id, radius, length, **kw):
    """A cylinder along local z."""
    return _body(id, {"kind": "cylinder", "radius": float(radius), "length": float(length)}, **kw)


def plane(id, sx, sy, **kw):
    return _body(id, {"kind": "plane", "size": [float(sx), float(sy)]}, **kw)


def mesh(id, vertices, indices, **kw):
    """A small triangle mesh: vertices as x,y,z (flat or triples), indices in threes. At most 20 000 vertices."""
    flat = [float(v) for vertex in vertices for v in (vertex if hasattr(vertex, "__len__") else [vertex])]
    return _body(id, {"kind": "mesh", "vertices": flat, "indices": [int(i) for i in indices]}, **kw)


def aircraft(id, span, length, **kw):
    """The world's own aircraft model: nose along local +x, up +z."""
    return _body(id, {"kind": "aircraft", "span": float(span), "length": float(length)}, **kw)


def rocket(id, radius, length, **kw):
    """The world's own rocket model: nose along local +x."""
    return _body(id, {"kind": "rocket", "radius": float(radius), "length": float(length)}, **kw)


# ---------- rotations ----------

def quat_multiply(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )


def _axis(angle, x, y, z):
    s = math.sin(angle / 2)
    return (math.cos(angle / 2), x * s, y * s, z * s)


def quat_from_euler(yaw, pitch, roll):
    """z-up, x forward, y left: yaw about z (counter-clockwise from +x), pitch nose-up positive, roll right-wing-down positive."""
    return quat_multiply(quat_multiply(_axis(yaw, 0, 0, 1), _axis(-pitch, 0, 1, 0)), _axis(roll, 1, 0, 0))


def _quat_from_matrix(m):
    """Row-major 3x3 rotation matrix (9 numbers) to (w, x, y, z)."""
    m00, m01, m02, m10, m11, m12, m20, m21, m22 = [float(v) for v in m]
    trace = m00 + m11 + m22
    if trace > 0:
        s = math.sqrt(trace + 1.0) * 2
        q = (0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s)
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        q = ((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s)
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        q = ((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s)
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2
        q = ((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s)
    n = math.sqrt(sum(c * c for c in q)) or 1.0
    return tuple(c / n for c in q)


# ---------- an experiment ----------

CODE_MAX = 64 * 1024


def _main_source():
    """The running script (`__main__`), when it's a small file: its name and text."""
    path = getattr(sys.modules.get("__main__"), "__file__", None)
    try:
        if not path or not os.path.isfile(path) or os.path.getsize(path) > CODE_MAX:
            return None
        with open(path, encoding="utf-8", errors="replace") as f:
            source = f.read(CODE_MAX)
    except OSError:
        return None
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", os.path.basename(path))[:120] or "main.py"
    return name, source


class Experiment:
    """One simulation on its plot of the world. Use it as a context manager: it ends when the block does (failed, if it raised).

    `phase` is where it is: "building" until its first frame, "testing" until it ends, then "examining".
    """

    def __init__(self, title, engine="custom", scene=(), extent=None, plot=None, speed=1.0, site=None):
        self.title = title
        self.speed = speed
        self.metrics = {}
        self.id = None
        self.scale = 1.0
        self.phase = "building"
        self._buffer = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._ended = False
        self._clock = None
        self._warned = False
        # Set when the node knows phases: until when (monotonic) the first frame waits while it's built.
        self._build_until = None
        self.live = bool(os.environ.get("GALAHAD_WORLD") and os.environ.get("GALAHAD_TOKEN"))
        if not self.live:
            _say("not in a Galahad sandbox with a network: the simulation runs, unseen")
            return
        body = {"title": str(title)[:120], "engine": engine, "scene": list(scene)}
        if extent:
            body["extent"] = float(extent)
        if plot:
            body["plot"] = plot
        if site:
            body["site"] = site
        try:
            started = _post("/experiments", body, {"authorization": f"Bearer {os.environ['GALAHAD_TOKEN']}"})
        except Exception as error:
            self.live = False
            _say(f"not shown in the world ({error}); the simulation runs anyway")
            return
        self.id, self._key, self.scale = started["id"], started["key"], started.get("scale", 1.0)
        if "build" in started:
            # A node that knows phases: the first frame holds while the world shows it built, and the script is kept.
            self._build_until = time.monotonic() + max(0.0, min(30.0, float(started["build"] or 0)))
            code = _main_source()
            if code:
                self._quietly(f"/experiments/{self.id}/code", {"name": code[0], "source": code[1]})
        self._thread = threading.Thread(target=self._send, name="galahad-world", daemon=True)
        self._thread.start()
        _say(f'"{title}" is being built in the SANDBOX ({self.id})')

    def _quietly(self, path, body):
        """A request the experiment can do without (an older node answers 404)."""
        try:
            _post(path, body, {"x-experiment-key": self._key})
        except Exception:
            pass

    def _built(self, poses):
        """Before the first frame: say how its bodies stand once built, wait while the world shows it put together, then say the test begins."""
        until, self._build_until = self._build_until, None
        self._quietly(f"/experiments/{self.id}/phase", {"phase": "building", "poses": {str(k): [round(float(v), 5) for v in p] for k, p in poses.items()}})
        wait = until - time.monotonic()
        if wait > 0.05:
            _say(f"Galahad is building it at the workshop's bench ({wait:.0f} s)")
            time.sleep(wait)
        self._quietly(f"/experiments/{self.id}/phase", {"phase": "testing"})

    def frame(self, t, poses, metrics=None):
        """Poses: {body id: (x, y, z, qw, qx, qy, qz)}; metrics: {name: number}. Paced to speed × real time."""
        if metrics:
            self.metrics.update({k: float(v) for k, v in metrics.items()})
        if self.phase == "building":
            self.phase = "testing"
            if self.live and not self._ended and self._build_until is not None:
                self._built(poses)
        if self.speed and self.speed > 0:
            now = time.monotonic()
            if self._clock is None:
                self._clock = (float(t), now)
            ahead = (float(t) - self._clock[0]) / self.speed - (now - self._clock[1])
            if ahead > 0:
                time.sleep(min(ahead, 2.0))
        if not self.live or self._ended:
            return
        frame = {"t": round(max(0.0, float(t)), 4), "poses": {str(k): [round(float(v), 5) for v in p] for k, p in poses.items()}}
        if metrics:
            frame["metrics"] = {str(k)[:40]: round(float(v), 6) for k, v in metrics.items() if math.isfinite(float(v))}
        with self._lock:
            self._buffer.append(frame)
            backlog = len(self._buffer)
            if backlog > 600 and self.speed and self.speed > 0:
                self._buffer = self._buffer[-600:]  # paced: never pile up behind a slow link
        if backlog > 600 and not (self.speed and self.speed > 0):
            self._flush(everything=True)  # unpaced: the simulation waits for the world instead

    def _flush(self, everything=False):
        while True:
            with self._lock:
                batch, self._buffer = self._buffer[:120], self._buffer[120:]
            if not batch:
                return
            try:
                _post(f"/experiments/{self.id}/frames", {"frames": batch}, {"x-experiment-key": self._key})
            except Exception as error:
                if not self._warned:
                    _say(f"frames didn't reach the world ({error})")
                    self._warned = True
                if str(error).startswith("409"):
                    self._ended = True
                    return
            if not everything:
                return

    def _send(self):
        while not self._stop.wait(0.1):
            self._flush()

    def end(self, status="done", summary=None, metrics=None):
        """Ends it in the world: done or failed, with a one-line summary. Then Galahad examines it."""
        if metrics:
            self.metrics.update({k: float(v) for k, v in metrics.items()})
        if not self.live or self._ended:
            self._ended = True
            self.phase = "examining"
            return
        self.phase = "examining"
        self._stop.set()
        self._thread.join(timeout=2)
        self._flush(everything=True)
        self._ended = True
        body = {"status": status}
        if summary:
            body["summary"] = str(summary)[:300]
        finite = {str(k)[:40]: v for k, v in self.metrics.items() if math.isfinite(v)}
        if finite:
            body["metrics"] = dict(list(finite.items())[:24])
        try:
            _post(f"/experiments/{self.id}/end", body, {"x-experiment-key": self._key})
            _say(f"{status}: Galahad examines it at the observatory (galahad experiments show {self.id})")
        except Exception as error:
            _say(f"couldn't end it in the world ({error})")

    def __enter__(self):
        return self

    def __exit__(self, kind, value, _tb):
        if not self._ended:
            self.end("failed", f"{kind.__name__}: {value}") if kind else self.end("done")
        return False


def experiment(title, **kw):
    """Start an experiment in the world: experiment(title, engine=..., scene=[...], extent=metres, plot="small"|"medium"|"large", speed=1.0, site=None).

    site says where it stands: "field" (the proving ground: aircraft over the runway, rockets on the launch pad,
    anything else on the rover course), "hall" (a test cell in the workshop) or "open" (a plot on open land).
    Without it the node chooses: aircraft and rockets on the proving ground, anything spanning less than a test
    cell indoors, the rest on open land. A site whose pads are all in use sends it to open land.
    """
    return Experiment(title, **kw)


# ---------- MuJoCo ----------

def _hex(rgba):
    r, g, b = (max(0, min(255, int(round(float(c) * 255)))) for c in rgba[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def mujoco_scene(model):
    """Every visible geom of a MuJoCo model as a body of the world (geoms on the world body are fixed)."""
    import mujoco

    G = mujoco.mjtGeom
    bodies = []
    for i in range(model.ngeom):
        rgba = model.geom_rgba[i]
        if rgba[3] == 0:
            continue
        kind, size = int(model.geom_type[i]), model.geom_size[i]
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, i) or f"geom{i}"
        common = {"color": _hex(rgba), "fixed": int(model.geom_bodyid[i]) == 0}
        if kind == G.mjGEOM_PLANE:
            bodies.append(plane(name, (size[0] or 10) * 2, (size[1] or 10) * 2, **common))
        elif kind == G.mjGEOM_SPHERE:
            bodies.append(sphere(name, size[0], **common))
        elif kind == G.mjGEOM_ELLIPSOID:
            bodies.append(sphere(name, max(size[:3]), **common))
        elif kind == G.mjGEOM_CAPSULE:
            bodies.append(capsule(name, size[0], size[1] * 2, **common))
        elif kind == G.mjGEOM_CYLINDER:
            bodies.append(cylinder(name, size[0], size[1] * 2, **common))
        elif kind == G.mjGEOM_BOX:
            bodies.append(box(name, size[0] * 2, size[1] * 2, size[2] * 2, **common))
        elif kind == G.mjGEOM_MESH and model.geom_dataid[i] >= 0:
            mid = model.geom_dataid[i]
            start, count = model.mesh_vertadr[mid], model.mesh_vertnum[mid]
            fstart, fcount = model.mesh_faceadr[mid], model.mesh_facenum[mid]
            if count <= 20000:
                bodies.append(mesh(name, model.mesh_vert[start : start + count].reshape(-1).tolist(), model.mesh_face[fstart : fstart + fcount].reshape(-1).tolist(), **common))
            else:
                r = float(model.geom_rbound[i])
                bodies.append(box(name, r, r, r, **common))
        else:
            r = float(model.geom_rbound[i]) or 0.05
            bodies.append(sphere(name, r, **common))
    return bodies


def mujoco_poses(model, data, scene=None, fixed=False):
    """Where each moving geom is now; with fixed=True the fixed ones too (the first frame)."""
    import mujoco

    names = None if scene is None else {b["id"] for b in scene if fixed or not b.get("fixed")}
    poses = {}
    for i in range(model.ngeom):
        if (int(model.geom_bodyid[i]) == 0 and not fixed) or model.geom_rgba[i][3] == 0:
            continue
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, i) or f"geom{i}"
        if names is not None and name not in names:
            continue
        x, y, z = data.geom_xpos[i]
        poses[name] = (x, y, z, *_quat_from_matrix(data.geom_xmat[i]))
    return poses


def mujoco_run(model, data=None, seconds=10.0, control=None, metrics=None, title="MuJoCo", fps=25, speed=1.0, plot=None, site=None):
    """Step a MuJoCo model for `seconds`, showing it in the world. control(model, data) sets data.ctrl each step; metrics(model, data) returns {name: number}."""
    import mujoco

    data = data or mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    scene = mujoco_scene(model)
    every = max(1, round(1.0 / (fps * model.opt.timestep)))
    extent = float(model.stat.extent) * 2 or None
    with experiment(title, engine="mujoco", scene=scene, extent=extent, plot=plot, speed=speed, site=site) as ex:
        ex.frame(data.time, mujoco_poses(model, data, scene, fixed=True), metrics(model, data) if metrics else None)
        step = 0
        while data.time < seconds:
            if control:
                control(model, data)
            mujoco.mj_step(model, data)
            step += 1
            if step % every == 0:
                ex.frame(data.time, mujoco_poses(model, data, scene), metrics(model, data) if metrics else None)
    return data


ARM_XML = """
<mujoco model="two-link arm">
  <option timestep="0.002" gravity="0 0 -9.81"/>
  <worldbody>
    <light pos="0 0 3"/>
    <geom name="floor" type="plane" size="1.2 1.2 0.1" rgba="0.36 0.42 0.38 1"/>
    <geom name="pedestal" type="cylinder" pos="0 0 0.25" size="0.08 0.25" rgba="0.3 0.32 0.36 1"/>
    <body name="upper" pos="0 0 0.55">
      <joint name="shoulder" type="hinge" axis="0 0 1" damping="0.5"/>
      <geom name="upper_link" type="capsule" fromto="0 0 0 0.5 0 0" size="0.04" rgba="0.85 0.65 0.2 1"/>
      <body name="fore" pos="0.5 0 0">
        <joint name="elbow" type="hinge" axis="0 0 1" damping="0.3"/>
        <geom name="fore_link" type="capsule" fromto="0 0 0 0.4 0 0" size="0.035" rgba="0.85 0.75 0.35 1"/>
        <geom name="hand" type="sphere" pos="0.4 0 0" size="0.05" rgba="0.9 0.3 0.25 1"/>
      </body>
    </body>
    <body name="target" mocap="true" pos="0.6 0 0.55">
      <geom name="target" type="sphere" size="0.03" rgba="0.2 0.7 0.95 0.9" contype="0" conaffinity="0"/>
    </body>
  </worldbody>
  <actuator>
    <motor joint="shoulder" gear="1" ctrlrange="-40 40" ctrllimited="true"/>
    <motor joint="elbow" gear="1" ctrlrange="-25 25" ctrllimited="true"/>
  </actuator>
</mujoco>
"""


def demo_arm(seconds=20.0, speed=1.0):
    """A two-link arm on a pedestal following a target around a circle (PD control on inverse kinematics). Metrics: tracking error."""
    import mujoco

    model = mujoco.MjModel.from_xml_string(ARM_XML)
    data = mujoco.MjData(model)
    l1, l2 = 0.5, 0.4

    def target(t):
        a = 0.6 * t
        return 0.55 + 0.2 * math.cos(a), 0.3 * math.sin(a)

    def control(model, data):
        x, y = target(data.time)
        data.mocap_pos[0] = (x, y, 0.55)
        d = min(1.0, max(-1.0, (x * x + y * y - l1 * l1 - l2 * l2) / (2 * l1 * l2)))
        elbow = math.acos(d)
        shoulder = math.atan2(y, x) - math.atan2(l2 * math.sin(elbow), l1 + l2 * math.cos(elbow))
        q, v = data.qpos, data.qvel
        data.ctrl[0] = 60 * (shoulder - q[0]) - 6 * v[0]
        data.ctrl[1] = 40 * (elbow - q[1]) - 4 * v[1]

    def metrics(model, data):
        hand = data.geom_xpos[model.geom("hand").id]
        x, y = target(data.time)
        return {"error_mm": 1000 * math.hypot(hand[0] - x, hand[1] - y)}

    data = mujoco_run(model, data, seconds=seconds, control=control, metrics=metrics, title="Two-link arm tracking a circle", speed=speed, plot="small")
    return data


# ---------- Gazebo (gz-sim 8, headless) ----------

def _quat_rotate(q, v):
    w, x, y, z = q
    p = quat_multiply(quat_multiply(q, (0.0, *v)), (w, -x, -y, -z))
    return p[1:]


def _pose_of(element):
    """An SDF <pose> (x y z roll pitch yaw) as (position, quaternion)."""
    text = element.findtext("pose") if element is not None else None
    values = [float(v) for v in (text or "").split()] + [0.0] * 6
    x, y, z, roll, pitch, yaw = values[:6]
    q = quat_multiply(quat_multiply(_axis(yaw, 0, 0, 1), _axis(pitch, 0, 1, 0)), _axis(roll, 1, 0, 0))
    return (x, y, z), q


def _sdf_color(visual):
    for tag in ("material/diffuse", "material/ambient"):
        text = visual.findtext(tag)
        if text:
            return _hex([float(v) for v in text.split()][:4])
    return None


def gazebo_scene(sdf_text):
    """The visuals of an SDF world's inline models as world bodies (<include>d models and meshes aren't drawn), with where each sits on its link."""
    import xml.etree.ElementTree as ET

    world = ET.fromstring(sdf_text).find("world")
    if world is None:
        raise ValueError("no <world> in this SDF")
    bodies, attach = [], {}
    for model in world.findall("model"):
        static = (model.findtext("static") or "").strip() == "true"
        for link in model.findall("link"):
            for visual in link.findall("visual"):
                geometry = visual.find("geometry")
                if geometry is None or len(geometry) == 0:
                    continue
                g = geometry[0]
                vid = f"{model.get('name')}::{link.get('name')}::{visual.get('name')}"
                common = {"color": _sdf_color(visual), "fixed": static}

                def nums(tag):
                    return [float(v) for v in (g.findtext(tag) or "").split()]

                if g.tag == "box":
                    body = box(vid, *nums("size")[:3], **common)
                elif g.tag == "sphere":
                    body = sphere(vid, nums("radius")[0], **common)
                elif g.tag == "cylinder":
                    body = cylinder(vid, nums("radius")[0], nums("length")[0], **common)
                elif g.tag == "capsule":
                    body = capsule(vid, nums("radius")[0], nums("length")[0], **common)
                elif g.tag == "plane":
                    sx, sy = (nums("size") + [20.0, 20.0])[:2]
                    body = plane(vid, min(sx, 40.0), min(sy, 40.0), **common)
                else:
                    continue
                bodies.append(body)
                attach[vid] = (model.get("name"), link.get("name"), _pose_of(visual))
    return bodies, attach


def gazebo_run(world, seconds=20.0, title=None, fps=25, speed=1.0, metrics=None, plot="medium", extent=None, site=None):
    """Run a Gazebo world (an SDF file path or SDF text) headlessly for `seconds`, showing its models' visuals in the world. metrics(info, ecm) returns {name: number}."""
    import tempfile
    import xml.etree.ElementTree as ET

    # Gazebo writes logs under $HOME; with nowhere writable it crashes, so give it somewhere.
    if not os.access(os.environ.get("HOME", "/"), os.W_OK):
        os.environ["HOME"] = tempfile.mkdtemp()
    import gz.math7  # noqa: F401  (registers the pose types the bindings return)
    from gz.sim8 import Link, Model, TestFixture, World, world_entity

    inline = world.lstrip().startswith("<")
    sdf_text = world if inline else open(world, encoding="utf8").read()
    path = world
    if inline:
        handle, path = tempfile.mkstemp(suffix=".sdf")
        with os.fdopen(handle, "w", encoding="utf8") as f:
            f.write(sdf_text)
    scene, attach = gazebo_scene(sdf_text)
    if not scene:
        raise ValueError("nothing to draw: the world's models have no box, sphere, cylinder, capsule or plane visuals")
    root = ET.fromstring(sdf_text).find("world")
    physics = root.find("physics")
    step = float(physics.findtext("max_step_size") or 0.001) if physics is not None else 0.001
    every = max(1, round(1.0 / (fps * step)))
    iterations = int(round(seconds / step))
    links, state = {}, {"n": 0, "first": True}

    with experiment(title or f"Gazebo: {root.get('name')}", engine="gazebo", scene=scene, extent=extent or 20.0, plot=plot, speed=speed, site=site) as ex:
        fixture = TestFixture(path)

        def post(info, ecm):
            state["n"] += 1
            if not state["first"] and state["n"] % every:
                return
            w = World(world_entity(ecm))
            poses = {}
            for body in scene:
                if body.get("fixed") and not state["first"]:
                    continue
                model_name, link_name, (vpos, vrot) = attach[body["id"]]
                key = (model_name, link_name)
                if key not in links:
                    links[key] = Link(Model(w.model_by_name(ecm, model_name)).link_by_name(ecm, link_name))
                pose = links[key].world_pose(ecm)
                if pose is None:
                    continue
                lrot = (pose.rot().w(), pose.rot().x(), pose.rot().y(), pose.rot().z())
                offset = _quat_rotate(lrot, vpos)
                poses[body["id"]] = (pose.pos().x() + offset[0], pose.pos().y() + offset[1], pose.pos().z() + offset[2], *quat_multiply(lrot, vrot))
            state["first"] = False
            ex.frame(info.sim_time.total_seconds(), poses, metrics(info, ecm) if metrics else None)

        fixture.on_post_update(post)
        fixture.finalize()
        fixture.server().run(True, iterations, False)
    return state["n"]


GAZEBO_DEMO = """<?xml version="1.0"?>
<sdf version="1.9">
  <world name="ramp_and_pendulum">
    <gravity>0 0 -9.81</gravity>
    <physics name="2ms" type="ignored"><max_step_size>0.002</max_step_size><real_time_factor>0</real_time_factor></physics>
    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>
    <model name="ground"><static>true</static><link name="link">
      <collision name="c"><geometry><plane><normal>0 0 1</normal><size>16 16</size></plane></geometry></collision>
      <visual name="v"><geometry><plane><normal>0 0 1</normal><size>16 16</size></plane></geometry><material><diffuse>0.55 0.7 0.55 1</diffuse></material></visual>
    </link></model>
    <model name="ramp"><static>true</static><pose>-1 0 0.9 0 0.35 0</pose><link name="link">
      <collision name="c"><geometry><box><size>4 1.6 0.1</size></box></geometry></collision>
      <visual name="v"><geometry><box><size>4 1.6 0.1</size></box></geometry><material><diffuse>0.85 0.7 0.5 1</diffuse></material></visual>
    </link></model>
    PIECES
    WALLS
    <model name="post"><static>true</static><pose>3 0 1.25 0 0 0</pose><link name="link">
      <collision name="c"><geometry><cylinder><radius>0.08</radius><length>2.5</length></cylinder></geometry></collision>
      <visual name="v"><geometry><cylinder><radius>0.08</radius><length>2.5</length></cylinder></geometry><material><diffuse>0.4 0.4 0.45 1</diffuse></material></visual>
    </link></model>
    <model name="pendulum">
      <pose>3 0.25 2.4 0 0 0</pose>
      <link name="upper"><pose>0.35 0 0 0 1.5708 0</pose>
        <inertial><mass>1</mass><inertia><ixx>0.04</ixx><iyy>0.04</iyy><izz>0.001</izz></inertia></inertial>
        <visual name="v"><geometry><capsule><radius>0.04</radius><length>0.6</length></capsule></geometry><material><diffuse>0.95 0.6 0.4 1</diffuse></material></visual>
      </link>
      <link name="lower"><pose>1.05 0 0 0 1.5708 0</pose>
        <inertial><mass>1</mass><inertia><ixx>0.04</ixx><iyy>0.04</iyy><izz>0.001</izz></inertia></inertial>
        <visual name="v"><geometry><capsule><radius>0.04</radius><length>0.6</length></capsule></geometry><material><diffuse>0.7 0.55 0.95 1</diffuse></material></visual>
      </link>
      <joint name="hinge" type="revolute"><parent>world</parent><child>upper</child><pose>0 0 -0.35 0 0 0</pose><axis><xyz>0 1 0</xyz></axis></joint>
      <joint name="knee" type="revolute"><parent>upper</parent><child>lower</child><pose>0 0 -0.35 0 0 0</pose><axis><xyz>0 1 0</xyz></axis></joint>
    </model>
  </world>
</sdf>
"""


def demo_gazebo(seconds=15.0, speed=1.0):
    """Balls and blocks tumbling down a ramp beside a double pendulum released level, in Gazebo (gz-sim 8, DART physics)."""
    import random

    rng = random.Random(7)
    pieces = []
    colors = ["0.95 0.75 0.4 1", "0.5 0.75 0.95 1", "0.95 0.55 0.65 1", "0.6 0.9 0.7 1"]
    for i in range(8):
        x, y, z = -2.4 + 0.35 * i, rng.uniform(-0.5, 0.5), 2.4 + 0.4 * i
        if i % 2:
            geometry, inertia = "<box><size>0.25 0.25 0.25</size></box>", "<ixx>0.005</ixx><iyy>0.005</iyy><izz>0.005</izz>"
        else:
            geometry, inertia = "<sphere><radius>0.15</radius></sphere>", "<ixx>0.0045</ixx><iyy>0.0045</iyy><izz>0.0045</izz>"
        pieces.append(
            f'<model name="piece{i}"><pose>{x:.2f} {y:.2f} {z:.2f} 0 0 0</pose><link name="link">'
            f"<inertial><mass>0.5</mass><inertia>{inertia}</inertia></inertial>"
            f'<collision name="c"><geometry>{geometry}</geometry></collision>'
            f'<visual name="v"><geometry>{geometry}</geometry><material><diffuse>{colors[i % 4]}</diffuse></material></visual></link></model>'
        )
    walls = []
    for name, (x, y, sx, sy) in {"north": (0, 4, 8.2, 0.2), "south": (0, -4, 8.2, 0.2), "east": (4, 0, 0.2, 8.2), "west": (-4, 0, 0.2, 8.2)}.items():
        size = f"{sx} {sy} 0.4"
        walls.append(
            f'<model name="wall_{name}"><static>true</static><pose>{x} {y} 0.2 0 0 0</pose><link name="link">'
            f'<collision name="c"><geometry><box><size>{size}</size></box></geometry></collision>'
            f'<visual name="v"><geometry><box><size>{size}</size></box></geometry><material><diffuse>0.78 0.74 0.68 1</diffuse></material></visual></link></model>'
        )
    world = GAZEBO_DEMO.replace("PIECES", "\n    ".join(pieces)).replace("WALLS", "\n    ".join(walls))
    return gazebo_run(world, seconds=seconds, title="Gazebo: a ramp and a double pendulum", speed=speed, extent=9)


# ---------- JSBSim: aircraft ----------

def jsbsim_fly(aircraft_model="c172x", seconds=240.0, lat=55.62, lon=12.65, altitude_m=600.0, speed_kts=100.0, heading_deg=90.0, bank_deg=20.0, control=None, title=None, fps=10, speed=4.0):
    """Fly a JSBSim aircraft, shown in the world. By default a simple autopilot holds altitude and flies circuits at `bank_deg`; control(fdm, t) replaces it."""
    import jsbsim

    fdm = jsbsim.FGFDMExec(None)
    fdm.set_debug_level(0)
    if not fdm.load_model(aircraft_model):
        raise ValueError(f"JSBSim has no aircraft {aircraft_model!r}")
    fdm["ic/lat-geod-deg"] = lat
    fdm["ic/long-gc-deg"] = lon
    fdm["ic/h-sl-ft"] = altitude_m / 0.3048
    fdm["ic/vc-kts"] = speed_kts
    fdm["ic/psi-true-deg"] = heading_deg
    fdm.run_ic()
    fdm["propulsion/set-running"] = -1
    fdm["fcs/mixture-cmd-norm"] = 1.0
    fdm["fcs/throttle-cmd-norm"] = 0.75
    dt = fdm.get_delta_t()
    target_alt = altitude_m
    held = {"i": 0.0}

    def autopilot(fdm, t):
        # Bank for the turn, then hold altitude with pitch, pitch with the elevator (pitch-up needs negative elevator).
        roll, p = fdm["attitude/phi-rad"], fdm["velocities/p-rad_sec"]
        fdm["fcs/aileron-cmd-norm"] = max(-1.0, min(1.0, 2.0 * (math.radians(bank_deg) - roll) - 0.4 * p))
        climb = fdm["velocities/h-dot-fps"] * 0.3048
        error = target_alt - fdm["position/h-sl-meters"]
        held["i"] = max(-0.1, min(0.1, held["i"] + 0.0002 * error * dt))
        want_pitch = max(-0.15, min(0.25, 0.004 * error - 0.02 * climb + 0.05 + held["i"]))
        pitch, q = fdm["attitude/theta-rad"], fdm["velocities/q-rad_sec"]
        fdm["fcs/elevator-cmd-norm"] = max(-1.0, min(1.0, -3.0 * (want_pitch - pitch) + 0.8 * q))
        fdm["fcs/rudder-cmd-norm"] = max(-1.0, min(1.0, -0.6 * fdm["velocities/r-rad_sec"] + 0.4 * fdm["aero/beta-rad"]))

    control = control or autopilot
    lat0, lon0 = math.radians(fdm["position/lat-geod-deg"]), fdm["position/long-gc-deg"]
    v = speed_kts * 0.5144
    radius = v * v / (9.81 * math.tan(math.radians(max(5.0, bank_deg))))
    every = max(1, round(1.0 / (fps * dt)))
    name = title or f"{aircraft_model} flying circuits at {bank_deg:.0f}° of bank"
    with experiment(name, engine="jsbsim", scene=[aircraft("plane", 11.0, 8.3, trail=True, color="#e9e4d8")], extent=2.6 * radius + 400, plot="large", speed=speed) as ex:
        step, lowest = 0, altitude_m
        while fdm.get_sim_time() < seconds:
            t = fdm.get_sim_time()
            control(fdm, t)
            if not fdm.run():
                raise RuntimeError("JSBSim stopped")
            step += 1
            altitude = fdm["position/h-sl-meters"]
            lowest = min(lowest, altitude)
            if altitude < 30:
                raise RuntimeError(f"it came down at t={t:.0f} s")
            if step % every == 0:
                north = math.radians(fdm["position/lat-geod-deg"] - math.degrees(lat0)) * 6_371_000
                east = math.radians(fdm["position/long-gc-deg"] - lon0) * 6_371_000 * math.cos(lat0)
                yaw = math.pi / 2 - fdm["attitude/psi-rad"]
                q = quat_from_euler(yaw, fdm["attitude/theta-rad"], fdm["attitude/phi-rad"])
                ex.frame(t, {"plane": (east, north, altitude, *q)}, {
                    "altitude_m": altitude,
                    "airspeed_kts": fdm["velocities/vc-kts"],
                    "bank_deg": math.degrees(fdm["attitude/phi-rad"]),
                    "pitch_deg": math.degrees(fdm["attitude/theta-rad"]),
                })
        ex.end("done", f"{seconds:.0f} s of circuits; lowest {lowest:.0f} m")
    return fdm


def demo_plane(seconds=240.0, speed=4.0):
    """A Cessna 172 flying circuits over Copenhagen at 600 m."""
    return jsbsim_fly(seconds=seconds, speed=speed)


# ---------- RocketPy: rockets ----------

def rocketpy_play(flight, title="Rocket flight", fps=20, speed=1.0, radius=None, length=None):
    """Show a computed RocketPy Flight in the world, from the rail to the ground (or its end)."""
    end = float(flight.t_final)
    elevation = float(flight.env.elevation)
    rocket_obj = flight.rocket
    r = float(radius or rocket_obj.radius)
    length = float(length or 20 * r)
    apogee = float(flight.apogee) - elevation
    reach = max(abs(float(flight.x(end))), abs(float(flight.y(end))), 1.0)
    # RocketPy's rocket axis is its body z; the world's rocket points along +x.
    align = _axis(-math.pi / 2, 0, 1, 0)
    with experiment(title, engine="rocketpy", scene=[rocket("rocket", r, length, trail=True, color="#f2efe6")], extent=1.3 * max(apogee, reach), plot="large", speed=speed) as ex:
        t, step = 0.0, 1.0 / fps
        while t <= end:
            q = quat_multiply((float(flight.e0(t)), float(flight.e1(t)), float(flight.e2(t)), float(flight.e3(t))), align)
            altitude = float(flight.z(t)) - elevation
            ex.frame(t, {"rocket": (float(flight.x(t)), float(flight.y(t)), altitude, *q)}, {
                "altitude_m": altitude,
                "speed_mps": float(flight.speed(t)),
                "mach": float(flight.mach_number(t)),
            })
            t += step
        ex.end("done", f"apogee {apogee:.0f} m at {float(flight.apogee_time):.1f} s; down after {end:.0f} s")
    return flight


def demo_rocket(speed=1.0):
    """A small rocket: a 3-second, 1.5 kN motor; standard atmosphere, no wind. RocketPy computes the flight, the world plays it."""
    from rocketpy import Environment, Flight, Rocket, SolidMotor

    env = Environment(latitude=55.6, longitude=12.6, elevation=0)
    env.set_atmospheric_model(type="standard_atmosphere")
    motor = SolidMotor(
        thrust_source=[(0, 0), (0.1, 1500), (2.9, 1400), (3.0, 0)],
        dry_mass=1.0,
        dry_inertia=(0.1, 0.1, 0.002),
        nozzle_radius=0.02,
        grain_number=4,
        grain_density=1700,
        grain_outer_radius=0.035,
        grain_initial_inner_radius=0.015,
        grain_initial_height=0.12,
        grain_separation=0.005,
        grains_center_of_mass_position=0.33,
        center_of_dry_mass_position=0.317,
        nozzle_position=0,
        burn_time=3.0,
        throat_radius=0.011,
        coordinate_system_orientation="nozzle_to_combustion_chamber",
    )
    body = Rocket(
        radius=0.0635,
        mass=8.0,
        inertia=(4.0, 4.0, 0.03),
        power_off_drag=0.45,
        power_on_drag=0.5,
        center_of_mass_without_motor=0.0,
        coordinate_system_orientation="tail_to_nose",
    )
    body.add_motor(motor, position=-1.25)
    body.add_nose(length=0.55, kind="vonKarman", position=1.25)
    body.add_trapezoidal_fins(n=4, root_chord=0.12, tip_chord=0.06, span=0.11, position=-1.05)
    body.add_parachute("main", cd_s=1.5, trigger="apogee", sampling_rate=100, lag=1.0)
    flight = Flight(rocket=body, environment=env, rail_length=5.0, inclination=86, heading=45, terminate_on_apogee=False, max_time=300)
    return rocketpy_play(flight, title="A 1.5 kN rocket to apogee and down", speed=speed, length=2.6)


if __name__ == "__main__":
    demos = {"arm": demo_arm, "plane": demo_plane, "rocket": demo_rocket, "gazebo": demo_gazebo}
    if len(sys.argv) != 2 or sys.argv[1] not in demos:
        print("usage: python3 -m galahad_world arm|plane|rocket|gazebo", file=sys.stderr)
        sys.exit(2)
    demos[sys.argv[1]]()
