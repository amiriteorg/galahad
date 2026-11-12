/*
 * The slice in the PlayCanvas engine 2.24 (WebGPU; WebGL2 with ?webgl=1), built the way PlayCanvas would have it:
 * StandardMaterial with its vertex transform chunk overridden (WGSL and GLSL) to move vertices in the vertex
 * shader, hardware instancing from a vertex buffer of matrices a kind, a PCF shadow, a Skin.
 *
 * Where it differs from the other two, for want of the same thing in the engine: the sky's light is a flat ambient
 * colour (no hemisphere light); an instance has a matrix and no colour of its own (the default instancing format);
 * the sun's shadow follows the view out to a distance instead of covering a fixed box.
 */
import * as pc from "playcanvas";
import { animals, figure, LIGHT, plants, sizes, terrain, view, walkAnimals } from "./content.js";
import { boneTurn, params, run } from "./harness.js";

const { x, webgl, mode } = params();
const canvas = document.getElementById("c");
canvas.width = innerWidth;
canvas.height = innerHeight;
const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [webgl ? pc.DEVICETYPE_WEBGL2 : pc.DEVICETYPE_WEBGPU], antialias: true });
device.maxPixelRatio = 1;
const options = new pc.AppOptions();
options.graphicsDevice = device;
options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
options.resourceHandlers = [];
const app = new pc.AppBase(canvas);
app.init(options);
app.setCanvasFillMode(pc.FILLMODE_NONE, innerWidth, innerHeight);
app.setCanvasResolution(pc.RESOLUTION_FIXED, innerWidth, innerHeight);
// (No local lights here: where it can be, the clustered lighting it would otherwise prepare each frame is turned off. On WebGPU it can't.)
if (webgl) app.scene.clusteredLightingEnabled = false;
app.scene.ambientLight = new pc.Color((LIGHT.sky[0] + LIGHT.ground[0]) * 0.25, (LIGHT.sky[1] + LIGHT.ground[1]) * 0.25, (LIGHT.sky[2] + LIGHT.ground[2]) * 0.25);
app.scene.fog.type = pc.FOG_EXP2;
app.scene.fog.density = LIGHT.fogDensity;
app.scene.fog.color = new pc.Color(...LIGHT.fog);

const camera = new pc.Entity("view");
camera.addComponent("camera", { fov: 45, nearClip: 0.5, farClip: 1500, clearColor: new pc.Color(...LIGHT.fog) });
app.root.addChild(camera);
const sun = new pc.Entity("sun");
sun.addComponent("light", { type: "directional", color: new pc.Color(...LIGHT.sun), intensity: 0.9, castShadows: true, shadowResolution: LIGHT.shadowSize, shadowDistance: 260, numCascades: 1, shadowType: pc.SHADOW_PCF3_32F, shadowBias: 0.2, normalOffsetBias: 0.06 });
// A directional light shines down its own -y: its +y turned to where the light comes from.
sun.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP, new pc.Vec3(...LIGHT.dir).normalize()));
app.root.addChild(sun);

const NL = String.fromCharCode(10);
const defaults = { wgsl: pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_WGSL).get("transformCoreVS"), glsl: pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL).get("transformCoreVS") };
const matt = () => {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(1, 1, 1);
  material.diffuseVertexColor = true;
  material.specular = new pc.Color(0, 0, 0);
  material.gloss = 0;
  material.useMetalness = false;
  return material;
};
/** The sway: the engine's own vertex transform chunk, with each vertex moved by its own weight and phase on a clock. */
const swaying = (amount, speed, axis) => {
  const material = matt();
  material.setAttribute("aSway", pc.SEMANTIC_ATTR10);
  const wgsl = defaults.wgsl.replace("var localPos: vec3f = vertexPosition;", `var localPos: vec3f = vertexPosition;${NL}localPos.${axis} += sin(uniform.uSwayClock * ${speed.toFixed(2)} + aSway.y) * aSway.x * ${amount.toFixed(2)};`);
  const glsl = defaults.glsl.replace("vec3 localPos = vertexPosition;", `vec3 localPos = vertexPosition;${NL}localPos.${axis} += sin(uSwayClock * ${speed.toFixed(2)} + aSway.y) * aSway.x * ${amount.toFixed(2)};`);
  if (wgsl === defaults.wgsl || glsl === defaults.glsl) throw new Error("the transform chunk isn't what this spike expects");
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("transformCoreVS", `attribute aSway: vec2f;${NL}uniform uSwayClock: f32;${NL}${wgsl}`);
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("transformCoreVS", `attribute vec2 aSway;${NL}uniform float uSwayClock;${NL}${glsl}`);
  material.setParameter("uSwayClock", 0);
  material.update();
  return material;
};
const rgba = (rgb) => {
  const out = new Float32Array((rgb.length / 3) * 4);
  for (let i = 0; i < rgb.length / 3; i++) out.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 1], i * 4);
  return out;
};
const meshOf = (g) => {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(g.positions);
  mesh.setNormals(g.normals);
  mesh.setColors(rgba(g.colors), 4);
  if (g.sway) mesh.setVertexStream(pc.SEMANTIC_ATTR10, g.sway, 2);
  return mesh;
};
const place = (mesh, material, cast, px = 0, pz = 0) => {
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const instance = new pc.MeshInstance(mesh, material);
  const entity = new pc.Entity();
  entity.addComponent("render", { meshInstances: [instance], castShadows: cast, receiveShadows: true });
  entity.setPosition(px, 0, pz);
  app.root.addChild(entity);
  return { instance, entity };
};
const instanced = (instance, matrices, count, dynamic) => {
  const buffer = new pc.VertexBuffer(device, pc.VertexFormat.getDefaultInstancingFormat(device), count, { usage: dynamic ? pc.BUFFER_DYNAMIC : pc.BUFFER_STATIC, data: matrices });
  instance.setInstancing(buffer);
  instance.cull = false;
  return buffer;
};

// ---- the land ----
const ground = matt();
ground.update();
for (const chunk of terrain(x)) place(meshOf(chunk), ground, false, chunk.x, chunk.z);

// ---- the plants ----
const leafy = swaying(0.25, 1.7, "x");
for (const kind of plants(x)) instanced(place(meshOf(kind), leafy, kind.shadow).instance, kind.matrices, kind.count, false);

// ---- the animals: their instances written every frame ----
const legged = swaying(0.3, 8, "z");
const herd = animals(x).map((kind) => {
  walkAnimals(kind, 0);
  return { kind, buffer: instanced(place(meshOf(kind), legged, true).instance, kind.matrices, kind.count, true) };
});

// ---- the figure ----
const f = figure();
const nodes = f.bones.map((_, i) => new pc.GraphNode(`bone${i}`));
const body = meshOf(f);
const boneIndex = new Uint8Array(f.skin.length * 4);
const boneWeight = new Float32Array(f.skin.length * 4);
f.skin.forEach((bone, v) => {
  boneIndex[v * 4] = bone;
  boneWeight[v * 4] = 1;
});
body.setVertexStream(pc.SEMANTIC_BLENDINDICES, boneIndex, 4, f.skin.length, pc.TYPE_UINT8);
body.setVertexStream(pc.SEMANTIC_BLENDWEIGHT, boneWeight, 4);
// Each bone's rest place in the figure's own frame, undone: its inverse bind pose.
const skin = new pc.Skin(device, f.rest.map(([rx, ry, rz]) => new pc.Mat4().setTranslate(-rx, -ry, -rz)), nodes.map((n) => n.name));
body.skin = skin;
const knightMaterial = matt();
knightMaterial.update();
const knight = place(body, knightMaterial, true);
f.bones.forEach((b, i) => {
  const sign = b.parent >= 0 && f.down[b.parent] ? -1 : 1;
  nodes[i].setLocalPosition(b.x, b.parent < 0 ? b.y : sign * b.y, b.z);
  (b.parent >= 0 ? nodes[b.parent] : knight.entity).addChild(nodes[i]);
});
knight.entity.setLocalScale(3, 3, 3);
const skinInstance = new pc.SkinInstance(skin);
skinInstance.bones = nodes;
knight.instance.skinInstance = skinInstance;
knight.instance.cull = false;

app.start();
// The engine's own frame (update, cull, shadows, draw), called from the harness's loop instead of its own.
const tick = app.tick;
app.tick = () => {};
pc.AppBase.cancelTick(app);

const DEG = 180 / Math.PI;
run(
  `playcanvas ${pc.version} ${device.isWebGPU ? "webgpu" : "webgl2"}${mode ? ` ${mode}` : ""}`,
  (t) => {
    const v = view(t);
    camera.setPosition(...v.eye);
    camera.lookAt(...v.at);
    leafy.setParameter("uSwayClock", t);
    legged.setParameter("uSwayClock", t);
    for (const { kind, buffer } of herd) {
      walkAnimals(kind, t);
      buffer.setData(kind.matrices);
    }
    for (let i = 0; i < nodes.length; i++) {
      const [rx, rz] = boneTurn(i, t);
      nodes[i].setLocalEulerAngles(rx * DEG, 0, rz * DEG);
    }
    tick(t * 1000);
  },
  () => ({ calls: app.stats.drawCalls.total || 0, triangles: 0, sizes: sizes(x) }),
);
