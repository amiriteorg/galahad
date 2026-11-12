/*
 * The slice in three.js 0.187's WebGPU renderer, built the way the SANDBOX builds its world: node materials (TSL)
 * that move vertices in the vertex shader, one InstancedMesh a kind with static buffers, a PCF shadow map.
 *   ?mode=bundle   the land and the plants (what never changes) in a BundleGroup: WebGPU render bundles
 *   ?mode=static   the same, and those objects marked `static` (their matrices aren't updated)
 *   ?webgl=1       the WebGL2 backend
 */
import { float, instanceIndex, positionLocal, sin, time, uv, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { animals, CHUNK, figure, LIGHT, plants, sizes, terrain, view, walkAnimals } from "./content.js";
import { boneTurn, params, run } from "./harness.js";

const { x, webgl, mode } = params();
const renderer = new THREE.WebGPURenderer({ canvas: document.getElementById("c"), antialias: true, forceWebGL: webgl });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(...LIGHT.fog);
scene.fog = new THREE.FogExp2(new THREE.Color(...LIGHT.fog), LIGHT.fogDensity);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 1500);
scene.add(new THREE.HemisphereLight(new THREE.Color(...LIGHT.sky), new THREE.Color(...LIGHT.ground), 1.6));
const sun = new THREE.DirectionalLight(new THREE.Color(...LIGHT.sun), 2.4);
sun.position.set(LIGHT.dir[0] * 150, LIGHT.dir[1] * 150, LIGHT.dir[2] * 150);
sun.castShadow = true;
sun.shadow.mapSize.set(LIGHT.shadowSize, LIGHT.shadowSize);
Object.assign(sun.shadow.camera, { left: -LIGHT.shadowBox, right: LIGHT.shadowBox, top: LIGHT.shadowBox, bottom: -LIGHT.shadowBox, near: 1, far: 400 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

const bundled = mode === "bundle" || mode === "static";
const still = bundled ? new THREE.BundleGroup() : new THREE.Group();
scene.add(still);
const rest = (object) => {
  if (mode === "static") object.static = true;
  object.matrixAutoUpdate = false;
  object.updateMatrix();
  return object;
};

const attribute = (array, size) => new THREE.BufferAttribute(array, size);
const geometryOf = (g) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", attribute(g.positions, 3));
  geometry.setAttribute("normal", attribute(g.normals, 3));
  geometry.setAttribute("color", attribute(g.colors, 3));
  if (g.sway) geometry.setAttribute("uv", attribute(g.sway, 2));
  return geometry;
};

// ---- the land ----
const ground = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
for (const chunk of terrain(x)) {
  const mesh = new THREE.Mesh(geometryOf(chunk), ground);
  mesh.position.set(chunk.x, 0, chunk.z);
  mesh.receiveShadow = true;
  mesh.geometry.computeBoundingSphere();
  // (In a bundle what's drawn is recorded once: nothing may be culled away when it is.)
  if (bundled) mesh.frustumCulled = false;
  still.add(rest(mesh));
}

// ---- the plants: sway in the vertex shader, by each vertex's own weight and phase ----
const swaying = (amount, speed, axis) => {
  const material = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
  const swing = sin(time.mul(speed).add(uv().y).add(float(instanceIndex).mul(0.37))).mul(uv().x).mul(amount);
  material.positionNode = positionLocal.add(axis === "x" ? vec3(swing, 0, 0) : vec3(0, 0, swing));
  return material;
};
const leafy = swaying(0.25, 1.7, "x");
for (const kind of plants(x)) {
  const mesh = new THREE.InstancedMesh(geometryOf(kind), leafy, kind.count);
  mesh.instanceMatrix.array.set(kind.matrices);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(kind.tints, 3);
  mesh.frustumCulled = false;
  mesh.castShadow = kind.shadow;
  mesh.receiveShadow = true;
  still.add(rest(mesh));
}

// ---- the animals: their instances written every frame, their legs swung in the vertex shader ----
const legged = swaying(0.3, 8, "z");
const herd = animals(x).map((kind) => {
  const mesh = new THREE.InstancedMesh(geometryOf(kind), legged, kind.count);
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(kind.matrices, 16);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { kind, mesh };
});

// ---- the figure: one skinned mesh ----
const f = figure();
const bones = f.bones.map(() => new THREE.Bone());
f.bones.forEach((b, i) => {
  const sign = b.parent >= 0 && f.down[b.parent] ? -1 : 1;
  bones[i].position.set(b.x, b.parent < 0 ? b.y : sign * b.y, b.z);
  if (b.parent >= 0) bones[b.parent].add(bones[i]);
});
const body = geometryOf(f);
const skinIndex = new Uint16Array(f.skin.length * 4);
const skinWeight = new Float32Array(f.skin.length * 4);
f.skin.forEach((bone, v) => {
  skinIndex[v * 4] = bone;
  skinWeight[v * 4] = 1;
});
body.setAttribute("skinIndex", attribute(skinIndex, 4));
body.setAttribute("skinWeight", attribute(skinWeight, 4));
const knight = new THREE.SkinnedMesh(body, new THREE.MeshLambertNodeMaterial({ vertexColors: true }));
knight.scale.setScalar(3);
knight.add(bones[0]);
scene.add(knight);
knight.updateMatrixWorld(true);
knight.bind(new THREE.Skeleton(bones));
knight.castShadow = knight.receiveShadow = true;
knight.frustumCulled = false;

// Everything compiled before the first frame, as the SANDBOX does.
await renderer.compileAsync(scene, camera);

let calls = 0;
let triangles = 0;
run(
  `three ${THREE.REVISION} ${renderer.backend.isWebGPUBackend ? "webgpu" : "webgl2"}${mode ? ` ${mode}` : ""}`,
  (t) => {
    const v = view(t);
    camera.position.set(...v.eye);
    camera.lookAt(...v.at);
    for (const { kind, mesh } of herd) {
      walkAnimals(kind, t);
      mesh.instanceMatrix.needsUpdate = true;
    }
    bones.forEach((bone, i) => {
      const [rx, rz] = boneTurn(i, t);
      bone.rotation.set(rx, 0, rz);
    });
    renderer.render(scene, camera);
    calls = renderer.info.render.drawCalls;
    triangles = renderer.info.render.triangles;
  },
  () => ({ calls, triangles, sizes: sizes(x), chunk: CHUNK }),
);
