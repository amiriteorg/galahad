/*
 * The slice in Babylon.js 9.36 (WebGPU engine; the WebGL2 engine with ?webgl=1), built the way Babylon would have
 * it: StandardMaterial with a material plugin that moves vertices in the vertex shader (WGSL and GLSL), thin
 * instances for every kind, a PCF shadow generator, a Skeleton.
 *   ?mode=snapshot        snapshot rendering, standard (a frame's draw calls recorded and replayed; uniforms still updated)
 *   ?mode=snapshot-fast   snapshot rendering, fast (only the scene's own uniforms and the buffers change)
 */
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { animals, figure, LIGHT, plants, sizes, terrain, view, walkAnimals } from "./content.js";
import { boneTurn, params, run } from "./harness.js";

const { x, webgl, mode } = params();
const ORIENTATION = Number(new URLSearchParams(location.search).get("side") ?? 1);
const canvas = document.getElementById("c");
canvas.width = innerWidth;
canvas.height = innerHeight;
let engine;
if (webgl) engine = new Engine(canvas, true, { adaptToDeviceRatio: false }, false);
else {
  engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
  await engine.initAsync();
}

const scene = new Scene(engine);
scene.useRightHandedSystem = true;
scene.clearColor = new Color4(...LIGHT.fog, 1);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = LIGHT.fogDensity;
scene.fogColor = new Color3(...LIGHT.fog);
scene.skipPointerMovePicking = true;
const camera = new FreeCamera("view", new Vector3(0, 45, 120), scene);
camera.fov = (45 * Math.PI) / 180;
camera.minZ = 0.5;
camera.maxZ = 1500;

const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
sky.diffuse = new Color3(...LIGHT.sky);
sky.groundColor = new Color3(...LIGHT.ground);
sky.specular = Color3.Black();
sky.intensity = 0.6;
const sun = new DirectionalLight("sun", new Vector3(-LIGHT.dir[0], -LIGHT.dir[1], -LIGHT.dir[2]), scene);
sun.position = new Vector3(LIGHT.dir[0] * 150, LIGHT.dir[1] * 150, LIGHT.dir[2] * 150);
sun.diffuse = new Color3(...LIGHT.sun);
sun.specular = Color3.Black();
sun.intensity = 1.2;
sun.autoUpdateExtends = false;
sun.autoCalcShadowZBounds = false;
sun.orthoLeft = sun.orthoBottom = -LIGHT.shadowBox;
sun.orthoRight = sun.orthoTop = LIGHT.shadowBox;
sun.shadowMinZ = 1;
sun.shadowMaxZ = 400;
const shadows = new ShadowGenerator(LIGHT.shadowSize, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.0005;
shadows.normalBias = 0.05;

/** A lit material in the vertex colours, matt. */
const matt = (name) => {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  // (The slice's triangles are wound counter-clockwise, as three.js has them.)
  material.sideOrientation = ORIENTATION;
  return material;
};
const rgba = (rgb) => {
  const out = new Float32Array((rgb.length / 3) * 4);
  for (let i = 0; i < rgb.length / 3; i++) out.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 1], i * 4);
  return out;
};
const meshOf = (name, g) => {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = rgba(g.colors);
  const indices = new Uint32Array(g.positions.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  data.indices = indices;
  data.applyToMesh(mesh);
  if (g.sway) mesh.setVerticesData("sway", g.sway, false, 2);
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
};

/** The sway, as a material plugin: each vertex moved by its own weight and phase on the plugin's clock, in the vertex shader. */
let clock = 0;
const NL = String.fromCharCode(10);
const sway = (amount, speed, axis) =>
  // (The base class asks for the code while it's being constructed: the numbers are the closure's, not the instance's.)
  class Sway extends MaterialPluginBase {
    constructor(material) {
      super(material, "Sway", 200, { SWAY: false });
      this._enable(true);
    }
    getClassName() {
      return "Sway";
    }
    isCompatible() {
      return true;
    }
    prepareDefines(defines) {
      defines.SWAY = true;
    }
    getAttributes(attributes) {
      attributes.push("sway");
    }
    getUniforms() {
      return { externalUniforms: ["swayClock"] };
    }
    bindForSubMesh(_buffer, _scene, _engine, subMesh) {
      subMesh.effect?.setFloat("swayClock", clock);
    }
    getCustomCode(shaderType, shaderLanguage = 0) {
      if (shaderType !== "vertex") return null;
      const move = `sin(CLOCK * ${speed.toFixed(2)} + SWAY.y) * SWAY.x * ${amount.toFixed(2)}`;
      if (shaderLanguage === 1)
        return {
          CUSTOM_VERTEX_DEFINITIONS: ["attribute sway: vec2f;", "uniform swayClock: f32;", ""].join(NL),
          CUSTOM_VERTEX_UPDATE_POSITION: `positionUpdated.${axis} += ${move.replaceAll("CLOCK", "uniforms.swayClock").replaceAll("SWAY", "vertexInputs.sway")};${NL}`,
        };
      return {
        CUSTOM_VERTEX_DEFINITIONS: ["attribute vec2 sway;", "uniform float swayClock;", ""].join(NL),
        CUSTOM_VERTEX_UPDATE_POSITION: `positionUpdated.${axis} += ${move.replaceAll("CLOCK", "swayClock").replaceAll("SWAY", "sway")};${NL}`,
      };
    }
  };

// ---- the land ----
const ground = matt("ground");
for (const chunk of terrain(x)) {
  const mesh = meshOf("chunk", chunk);
  mesh.material = ground;
  mesh.position.set(chunk.x, 0, chunk.z);
  mesh.freezeWorldMatrix();
  // (A snapshot records what's drawn once: nothing may be left out of it.)
  if (mode) mesh.alwaysSelectAsActiveMesh = true;
}

// ---- the plants: thin instances, a matrix and a colour each ----
const leafy = matt("leafy");
new (sway(0.25, 1.7, "x"))(leafy);
for (const kind of plants(x)) {
  const mesh = meshOf("plant", kind);
  mesh.material = leafy;
  mesh.thinInstanceSetBuffer("matrix", kind.matrices, 16, true);
  mesh.thinInstanceSetBuffer("color", rgba(kind.tints), 4, true);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.freezeWorldMatrix();
  if (kind.shadow) shadows.addShadowCaster(mesh);
}

// ---- the animals: their instances written every frame ----
const legged = matt("legged");
new (sway(0.3, 8, "z"))(legged);
const herd = animals(x).map((kind) => {
  const mesh = meshOf("animal", kind);
  mesh.material = legged;
  walkAnimals(kind, 0);
  mesh.thinInstanceSetBuffer("matrix", kind.matrices, 16, false);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.freezeWorldMatrix();
  shadows.addShadowCaster(mesh);
  return { kind, mesh };
});

// ---- the figure ----
const f = figure();
const skeleton = new Skeleton("figure", "figure", scene);
const bones = [];
f.bones.forEach((b, i) => {
  const sign = b.parent >= 0 && f.down[b.parent] ? -1 : 1;
  bones.push(new Bone(`bone${i}`, skeleton, b.parent >= 0 ? bones[b.parent] : null, Matrix.Translation(b.x, b.parent < 0 ? b.y : sign * b.y, b.z)));
});
const knight = meshOf("figure", f);
const indices = new Float32Array(f.skin.length * 4);
const weights = new Float32Array(f.skin.length * 4);
f.skin.forEach((bone, v) => {
  indices[v * 4] = bone;
  weights[v * 4] = 1;
});
knight.setVerticesData("matricesIndices", indices, false, 4);
knight.setVerticesData("matricesWeights", weights, false, 4);
knight.skeleton = skeleton;
knight.numBoneInfluencers = 1;
knight.material = matt("figure");
knight.scaling.setAll(3);
knight.alwaysSelectAsActiveMesh = true;
shadows.addShadowCaster(knight);

await scene.whenReadyAsync();
if (mode.startsWith("snapshot")) {
  engine.snapshotRenderingMode = mode === "snapshot-fast" ? Constants.SNAPSHOTRENDERING_FAST : Constants.SNAPSHOTRENDERING_STANDARD;
  engine.snapshotRendering = true;
}

const target = new Vector3();
let calls = 0;
run(
  `babylon ${Engine.Version} ${engine.isWebGPU ? "webgpu" : "webgl2"}${mode ? ` ${mode}` : ""}`,
  (t) => {
    const v = view(t);
    camera.position.set(...v.eye);
    camera.setTarget(target.set(...v.at));
    clock = t;
    for (const { kind, mesh } of herd) {
      walkAnimals(kind, t);
      mesh.thinInstanceBufferUpdated("matrix");
    }
    for (let i = 0; i < bones.length; i++) {
      const [rx, rz] = boneTurn(i, t);
      bones[i].setYawPitchRoll(0, rx, rz);
    }
    engine._drawCalls.fetchNewFrame();
    engine.beginFrame();
    scene.render();
    engine.endFrame();
    calls = engine._drawCalls.current;
  },
  () => ({ calls, triangles: 0, sizes: sizes(x) }),
);
