/** Ambient declarations for three.js addons (untyped examples/jsm surface)
 *  plus PMREMGenerator which this three build exports from core. */
import type * as _T from 'three'

declare module 'three' {
  export class PMREMGenerator {
    constructor(renderer: unknown)
    compileEquirectangularPMREM(...args: unknown[]): void
    compileCubemapPMREM(...args: unknown[]): void
    fromScene(scene: _T.Scene, sigma?: number, near?: number, far?: number): _T.WebGLRenderTarget
    fromEquirectangularHDR(...args: unknown[]): _T.WebGLRenderTarget
    fromCubemap(...args: unknown[]): _T.WebGLRenderTarget
    dispose(): void
  }
}

declare module 'three/addons/postprocessing/*.js' {
  const anyExport: any
  export = anyExport
}
