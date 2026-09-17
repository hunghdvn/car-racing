import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { GRAPHICS, QUALITY, THEME } from '../config'
import { applySkyEnvironment, sunDirection, type Sky } from './SkyEnv'

export type QualityTier = 'high' | 'medium' | 'low'

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDark: { value: GRAPHICS.vignetteDarkness },
    uOff: { value: GRAPHICS.vignetteOffset },
    uTint: { value: new THREE.Color(0x0a1018) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uDark; uniform float uOff; uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5)) * 1.414;
      float v = smoothstep(0.74 - uOff, 1.02 - uOff * 0.5, d) * uDark;
      c.rgb *= mix(vec3(1.0), uTint, min(1.0, v * 1.8));
      c.rgb *= (1.0 - v);
      // filmic dither to break 8-bit banding on skies/fog gradients
      float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (dn - 0.5) * (1.0 / 255.0);
      gl_FragColor = c;
    }`,
}

/**
 * Core render pipeline (spec rev.3 §3/§12): WebGL2 renderer + composer
 * (bloom, vignette, ACES output), single shadow-casting sun with a
 * player-following ortho frustum, hemisphere fill, adaptive quality.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly sun: THREE.DirectionalLight
  readonly hemi: THREE.HemisphereLight
  readonly sunDir: THREE.Vector3
  tier: QualityTier = 'high'
  fps = 0

  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private vignette: ShaderPass
  private renderTarget: THREE.WebGLRenderTarget
  private sky: Sky | null = null
  private emaFrameMs = 16.7
  private lastDegradeAt = -Infinity
  private lowFor = 0
  private ready = false

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
    // counters are sampled manually for the whole composer chain (see composerRenderSafe)
    this.gl.info.autoReset = false
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, GRAPHICS.maxPixelRatio))
    this.gl.toneMapping = THREE.ACESFilmicToneMapping
    this.gl.toneMappingExposure = GRAPHICS.exposure
    this.gl.shadowMap.enabled = true
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap
    this.gl.setClearColor(new THREE.Color(0x0b1220), 1)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.14, 1750)
    this.scene.add(this.camera)

    // sun (the one shadow caster, spec §12)
    this.sunDir = sunDirection()
    this.sun = new THREE.DirectionalLight(new THREE.Color(THEME.sunColor).convertSRGBToLinear(), THEME.sunIntensity)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(QUALITY[this.tier].shadowMap, QUALITY[this.tier].shadowMap)
    this.sun.shadow.bias = GRAPHICS.shadowBias
    this.sun.shadow.normalBias = GRAPHICS.shadowNormalBias
    const sc = this.sun.shadow.camera
    sc.left = -GRAPHICS.shadowExtent / 2; sc.right = GRAPHICS.shadowExtent / 2
    sc.top = GRAPHICS.shadowExtent / 2; sc.bottom = -GRAPHICS.shadowExtent / 2
    sc.near = GRAPHICS.shadowNearFar[0]; sc.far = GRAPHICS.shadowNearFar[1]
    sc.updateProjectionMatrix()
    this.sun.shadow.radius = 3.2
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.hemi = new THREE.HemisphereLight(
      new THREE.Color(THEME.skyMid).convertSRGBToLinear(),
      new THREE.Color(THEME.groundHemi).convertSRGBToLinear(),
      THEME.hemiIntensity,
    )
    this.scene.add(this.hemi)

    // post chain
    this.renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      samples: 0,
    })
    this.composer = new EffectComposer(this.gl, this.renderTarget)
    const rp = new RenderPass(this.scene, this.camera)
    rp.clear = true
    this.composer.addPass(rp)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), GRAPHICS_BLOOM.strength, GRAPHICS.bloomRadius, GRAPHICS.bloomThreshold)
    this.composer.addPass(this.bloom)
    this.vignette = new ShaderPass(VignetteShader)
    this.composer.addPass(this.vignette)
    this.composer.addPass(new OutputPass())

    window.addEventListener('resize', () => this.resize())
    this.resize()
  }

  attachSky(sky: Sky): void {
    this.sky = sky
    applySkyEnvironment(this.gl, this.scene, sky)
  }

  /** Per-frame update: sky follows camera, shadow frustum follows focus, perf sampler. */
  update(dt: number, focus: THREE.Vector3 | null): void {
    if (this.sky) this.sky.update(dt, this.camera.position)
    if (focus) this.updateShadowFor(focus)
    this.emaFrameMs = this.emaFrameMs * 0.92 + Math.max(dt, 1e-4) * 1000 * 0.08
    this.fps = 1000 / this.emaFrameMs
    if (!this.ready && this.emaFrameMs < 40) this.ready = true
    // adaptive degrade (spec §12 downgrade order, gentle & rare)
    if (this.ready && this.emaFrameMs > 19.2) {
      this.lowFor += dt
      if (this.lowFor > 2.6 && performance.now() - this.lastDegradeAt > 4000) {
        if (this.tier === 'high') this.setTier('medium')
        else if (this.tier === 'medium') this.setTier('low')
        this.lastDegradeAt = performance.now()
        this.lowFor = 0
      }
    } else {
      this.lowFor = Math.max(0, this.lowFor - dt * 2)
    }
  }

  setTier(tier: QualityTier): void {
    this.tier = tier
    const q = QUALITY[tier]
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio))
    this.bloom.strength = q.bloom
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap)
    const sm = this.sun.shadow.map as THREE.WebGLRenderTarget | null
    if (sm) { sm.dispose(); this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget }
    this.resize()
  }

  /** dev-only (Gate A debug): raw pipeline handles for pixel-level bisect probes. */
  get debugPipeline(): { composer: EffectComposer; bloom: UnrealBloomPass; vignette: ShaderPass } {
    return { composer: this.composer, bloom: this.bloom, vignette: this.vignette }
  }
  render(mode = 0): void {
    if (mode === 1) this.gl.render(this.scene, this.camera)
    else if (mode === 2) { this.bloom.enabled = false; this.composer.render(); this.bloom.enabled = true }
    else if (mode === 3) { const s = this.bloom.strength; this.bloom.strength = 0; this.composer.render(); this.bloom.strength = s }
    else if (mode === 4) {
      this.sun.castShadow = false
      const sm = this.sun.shadow.map as THREE.WebGLRenderTarget | null
      if (sm) { sm.dispose(); this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget }
      this.gl.shadowMap.needsUpdate = true; this.composer.render(); this.sun.castShadow = true
    }
    else this.composerRenderSafe()
  }

  /**
   * Freeze shadow-map auto-update for the duration of the composer chain.
   * The RenderPass inside the composer triggers exactly one shadow-map refresh
   * (via needsUpdate=true). UnrealBloomPass's many internal renderer.render()
   * calls would otherwise re-enter WebGLShadowMap.render() and corrupt the
   * WebGL state machine (blending, depth-test, render-target binding) that
   * the subsequent post-processing passes rely on — producing a black canvas
   * when standard/physical car meshes are present.
   */
  private composerRenderSafe(): void {
    this.gl.shadowMap.autoUpdate = false
    this.gl.shadowMap.needsUpdate = true
    this.gl.info.reset()
    try {
      this.composer.render()
    } finally {
      this.gl.shadowMap.autoUpdate = true
      this.lastChain = { calls: this.gl.info.render.calls, tris: this.gl.info.render.triangles }
    }
  }
  /** draw calls/triangles of the most recent full composer chain (dev probe) */
  lastChain = { calls: 0, tris: 0 }

  /** Dev-only (kit shots): re-aim the shadow frustum at an arbitrary focus. */
  setShadowFocus(p: THREE.Vector3): void {
    this.updateShadowFor(p)
    this.gl.shadowMap.needsUpdate = true
  }

  private updateShadowFor(p: THREE.Vector3): void {
    this.sun.position.copy(p).addScaledVector(this.sunDir, 240)
    this.sun.target.position.copy(p)
    this.sun.target.updateMatrixWorld()
  }

  /** Dev-only (kit boards): widen/narrow the sun's ortho shadow frustum so the
   *  isolated display boards (up to 460 m across) sit INSIDE it — otherwise
   *  their shadow map is never rendered and the boards float without ground
   *  contact shadows when their frames serve as evidence. */
  setShadowExtent(e: number): void {
    const sc = this.sun.shadow.camera
    if (Math.abs(sc.right - e / 2) < 0.01) return
    sc.left = -e / 2; sc.right = e / 2; sc.top = e / 2; sc.bottom = -e / 2
    ;(sc as unknown as { updateProjectionMatrix?: () => void }).updateProjectionMatrix?.()
    this.gl.shadowMap.needsUpdate = true
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight
    this.gl.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }
}

const GRAPHICS_BLOOM = { strength: GRAPHICS.bloomStrength, radius: GRAPHICS.bloomRadius, threshold: GRAPHICS.bloomThreshold }
