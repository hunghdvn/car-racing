import * as THREE from 'three'
import { THEME, TRACK } from '../config'
import { sunDirection } from '../core/SkyEnv'

/* ------------------------------------------------------------------------- *
 * Sea surface (spec §4.5/§9): two scrolled procedural normal layers,
 * fresnel sky mix, sun glint, depth-tinted colour from a baked shore/depth
 * map, foam line along the shoreline with wobble — a surface with behaviour,
 * never a flat blue plane.
 * ------------------------------------------------------------------------- */

export interface ShoreMap { texture: THREE.Texture; x0: number; z0: number; spanX: number; spanZ: number }

const WATER_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uOrigin; // mesh translation (this GLSL env lacks modelMatrix)
varying vec3 vWorld;
varying vec2 vGrid;
void main() {
  vec4 wp = vec4(position + uOrigin, 1.0);
  wp.y += 0.065 * sin(wp.x * 0.055 + uTime * 0.7) * sin(wp.z * 0.041 - uTime * 0.5)
        + 0.045 * sin(wp.x * 0.013 - wp.z * 0.017 + uTime * 0.33);
  vWorld = wp.xyz;
  vGrid = position.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const WATER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uSeaLevel, uYMin, uYMax, uFogDensity;
uniform vec4 uRect; // x0 z0 spanX spanZ
uniform vec3 uSunDir, uSunCol, uSkyTint, uHorizonCol, uDeep, uShallow, uFoamCol, uFogColor, uCam;
uniform sampler2D uShore;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float wave(vec2 p, float t) {
  return 0.55 * noise2(p * 0.16 + vec2(t * 0.09, t * 0.05))
       + 0.32 * noise2(p * 0.5 - vec2(t * 0.16, t * 0.11))
       + 0.18 * noise2(p * 1.7 + vec2(t * 0.32, -t * 0.27));
}

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  // procedural bump: gradient of two scrolled noise layers
  float e = 0.34;
  float h0 = wave(p, t);
  float hx = wave(p + vec2(e, 0.0), t);
  float hz = wave(p + vec2(0.0, e), t);
  vec3 n = normalize(vec3((h0 - hx) * 1.9, 0.62, (h0 - hz) * 1.9));

  vec3 v = normalize(uCam - vWorld);
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);

  // depth from the baked shore map
  vec2 uv = (p - uRect.xy) / uRect.zw;
  float shoreH = -12.0;
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
    shoreH = mix(uYMin, uYMax, texture2D(uShore, uv).r);
  }
  float depth = max(uSeaLevel - shoreH, 0.0);
  float dT = clamp(depth / 5.2, 0.0, 1.0);
  vec3 body = mix(uShallow, uDeep, dT);
  // shallows lean brighter/clearer than the deep body (readable depth tint)
  body = mix(body, uShallow * 1.16 + vec3(0.012, 0.02, 0.018), smoothstep(1.5, 0.25, depth) * 0.45);
  // distance haze shift toward the horizon colour far out
  float camD = length(uCam - vWorld);
  body = mix(body, uHorizonCol * 0.72, smoothstep(120.0, 620.0, camD) * 0.55);

  vec3 col = mix(body, uSkyTint, fres * 0.58);

  // sun glint: tight sparkle + restrained broad sheen (no blown sheet)
  vec3 hv = normalize(uSunDir + v);
  float spec = pow(max(dot(n, hv), 0.0), 140.0) * 7.0
              + pow(max(dot(n, hv), 0.0), 26.0) * 0.24;
  col += uSunCol * spec * smoothstep(0.0, 0.25, uSunDir.y);

  // caustics shimmer in the shallows (spec §4.5/§9): two counter-scrolled
  // cellular ridges brighten the bed-facing water near the shore, gated by
  // sun elevation so dusk reads, noon sparkles
  float ca1 = noise2(p * 0.62 + vec2(t * 0.21, -t * 0.13));
  float ca2 = noise2(p * 0.58 - vec2(t * 0.16, t * 0.23) + 4.7);
  float ca = pow(1.0 - abs(ca1 * 2.0 - 1.0), 3.0) * pow(1.0 - abs(ca2 * 2.0 - 1.0), 3.0);
  float caGate = smoothstep(1.7, 0.3, depth) * smoothstep(0.02, 0.22, uSunDir.y);
  col += uSunCol * ca * caGate * 0.5;
  // shoreline foam: narrow wobbled band hugging the waterline only
  float wob = (noise2(p * 0.35 + vec2(t * 0.22)) - 0.5) * 0.3;
  float foam = smoothstep(0.42 + wob, 0.05, depth);
  float rip = smoothstep(0.86, 1.0, sin(depth * 2.6 - t * 1.4 + noise2(p * 0.6) * 3.0) * 0.5 + 0.5);
  foam = max(foam, foam * rip * 0.8) * (1.0 - smoothstep(3.0, 5.0, depth));
  col = mix(col, uFoamCol, clamp(foam, 0.0, 1.0) * 0.62);

  // exp2 fog matched to the sky (same curve as FogExp2)
  float f = 1.0 - exp(-uFogDensity * uFogDensity * camD * camD);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
}
`

// injected by the harness closure below (kept out of the uniform block to
// make the eye-adjustable sun path obvious)
function uCamPosGlsl(): string { return 'cameraPosition' }
const WATER_FRAG_FINAL = WATER_FRAG.replace(/uCamPos\(\)/g, 'cameraPosition')
void uCamPosGlsl

export function buildWater(shore: ShoreMap): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1500, 900, 128, 76)
  geo.rotateX(-Math.PI / 2)
  const sunDir = sunDirection()
  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG_FINAL,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3(0, TRACK.coast.seaLevel, -360) },
      uCam: { value: new THREE.Vector3(0, 2, 0) },
      uSeaLevel: { value: TRACK.coast.seaLevel },
      uYMin: { value: -14 },
      uYMax: { value: 10 },
      uFogDensity: { value: THEME.fogDensity },
      uRect: { value: new THREE.Vector4(shore.x0, shore.z0, shore.spanX, shore.spanZ) },
      uShore: { value: shore.texture },
      uSunDir: { value: sunDir },
      uSunCol: { value: new THREE.Color(THEME.water.spec).convertSRGBToLinear().multiplyScalar(1.15) },
      uSkyTint: { value: new THREE.Color(THEME.skyHorizon).convertSRGBToLinear() },
      uHorizonCol: { value: new THREE.Color(THEME.fogColor).convertSRGBToLinear() },
      uDeep: { value: new THREE.Color(THEME.water.deep).convertSRGBToLinear() },
      uShallow: { value: new THREE.Color(THEME.water.shallow).convertSRGBToLinear() },
      uFoamCol: { value: new THREE.Color(THEME.water.foam).convertSRGBToLinear() },
      uFogColor: { value: new THREE.Color(THEME.fogColor).convertSRGBToLinear() },
    },
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(0, TRACK.coast.seaLevel, -360)
  mesh.name = 'sea'
  mesh.frustumCulled = false
  mesh.renderOrder = -900
  ;(mesh as unknown as { __waterMat: THREE.ShaderMaterial }).__waterMat = mat
  return mesh
}

/** Advance water animation (call each frame with elapsed seconds). */
export function animateWater(mesh: THREE.Mesh, t: number, cam: THREE.Vector3): void {
  const m = (mesh as unknown as { __waterMat?: THREE.ShaderMaterial }).__waterMat
  if (m) { m.uniforms.uTime.value = t; m.uniforms.uCam.value.copy(cam) }
}
