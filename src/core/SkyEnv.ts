import * as THREE from 'three'
import { PMREMGenerator } from 'three'
import { THEME } from '../config'

const DEG = Math.PI / 180

export function sunDirection(): THREE.Vector3 {
  const el = THEME.sunElevationDeg * DEG
  const az = THEME.sunAzimuthDeg * DEG
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize()
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uZenith, uMid, uHorizon, uSunTint, uSunDir;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise2(p); p *= 2.07; a *= 0.52; }
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  // layered gradient: warm horizon -> mid blue -> zenith deep
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.16, max(h, 0.0)));
  col = mix(col, uZenith, smoothstep(0.10, 0.62, max(h, 0.0)));
  col = mix(col, uHorizon * 0.72, smoothstep(0.0, 0.22, -h));
  // sun glow + disc
  float sd = dot(dir, normalize(uSunDir));
  float glow = pow(max(sd, 0.0), 26.0) * 0.75 + pow(max(sd, 0.0), 4.0) * 0.18;
  col += uSunTint * glow;
  col += uSunTint * smoothstep(0.99930, 0.99962, sd) * 9.0;
  // drifting clouds projected onto a plane above the horizon
  float mh = max(h, 0.035);
  vec2 cp = dir.xz / (mh + 0.16) * 0.9 + vec2(uTime * 0.0042, uTime * 0.0026);
  float c = fbm(cp * 1.22);
  float cl = smoothstep(0.50, 0.74, c) * smoothstep(0.018, 0.11, h);
  float warm = pow(max(sd * 0.6 + 0.4, 0.0), 2.2);
  vec3 cloudCol = mix(vec3(0.62, 0.65, 0.72), vec3(1.0, 0.79, 0.55), warm);
  col = mix(col, cloudCol, cl * 0.72);
  gl_FragColor = vec4(col, 1.0);
}
`

/** Procedural golden-hour sky dome (shared shader with the PMREM bake). */
export class Sky {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  readonly sunDir: THREE.Vector3

  constructor(radius = 1100) {
    this.sunDir = sunDirection()
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunDir.clone() },
        uZenith: { value: new THREE.Color(THEME.skyZenith).convertSRGBToLinear() },
        uMid: { value: new THREE.Color(THEME.skyMid).convertSRGBToLinear() },
        uHorizon: { value: new THREE.Color(THEME.skyHorizon).convertSRGBToLinear() },
        uSunTint: { value: new THREE.Color(THEME.skySunTint).convertSRGBToLinear() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1000
    this.mesh.name = 'sky'
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.material.uniforms.uTime.value += dt
    this.mesh.position.copy(camPos)
  }
}

/** Bake PMREM environment + wire scene fog from the same sky. Adds mesh to scene. */
export function applySkyEnvironment(gl: THREE.WebGLRenderer, scene: THREE.Scene, sky: Sky): void {
  scene.add(sky.mesh)
  scene.fog = new THREE.FogExp2(THEME.fogColor, THEME.fogDensity)
  const gen = new PMREMGenerator(gl)
  const envScene = new THREE.Scene()
  envScene.add(sky.mesh.clone())
  const rt = gen.fromScene(envScene, 0.02, 1, 2200)
  scene.environment = rt.texture
  scene.environmentIntensity = THEME.envIntensity
  gen.dispose()
}
