/**
 * Vitest setup — runs once per test file, before any test code.
 *
 * jsdom ships no canvas implementation: `HTMLCanvasElement.getContext()`
 * returns null unless the (native, heavy) `canvas` package is installed.
 * That is normally harmless, because nothing here draws — except that
 * lottie-web touches a canvas while its MODULE is being evaluated, not
 * when a component renders:
 *
 *     var proxyImage = function () {
 *       var canvas = createTag('canvas');
 *       var ctx = canvas.getContext('2d');   // → null under jsdom
 *       ctx.fillStyle = 'rgba(0,0,0,0)';     // → TypeError
 *     }();
 *
 * So the mere act of importing anything that eventually reaches
 * `lottie-react` blows up on import. App.jsx does, via
 * CelebrationOverlay, which is why the parse smoke test failed while
 * every other suite passed.
 *
 * A minimal 2D context stub is enough: nothing asserts on pixels, we just
 * need the calls to land somewhere. Installed only when the real thing is
 * genuinely missing, so adding the `canvas` package later silently takes
 * precedence over this.
 */

function stub2dContext() {
  const noop = () => {}
  return {
    // Drawing state / style properties are plain assignable fields; the
    // object literal below only needs to accept the writes.
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',

    canvas: null,

    save: noop,
    restore: noop,
    scale: noop,
    rotate: noop,
    translate: noop,
    transform: noop,
    setTransform: noop,
    resetTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    arcTo: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    setLineDash: noop,
    getLineDash: () => [],
    measureText: () => ({ width: 0 }),
    createImageData: (w = 1, h = 1) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
    getImageData: (_x, _y, w = 1, h = 1) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
  }
}

if (typeof HTMLCanvasElement !== 'undefined') {
  const real = HTMLCanvasElement.prototype.getContext
  // Probe rather than assume. jsdom returns null (and logs to its virtual
  // console); a jsdom built against `canvas` returns a real context, and
  // in that case we must not shadow it.
  let hasRealContext = false
  try {
    hasRealContext = !!real?.call(document.createElement('canvas'), '2d')
  } catch {
    hasRealContext = false
  }

  if (!hasRealContext) {
    HTMLCanvasElement.prototype.getContext = function getContext(type) {
      if (type === '2d') {
        const ctx = stub2dContext()
        ctx.canvas = this
        return ctx
      }
      // WebGL and friends stay null — nothing in this app asks for them,
      // and returning a fake would hide a real problem rather than fix one.
      return null
    }
  }

  // lottie-web also reads back a data URL from its proxy image.
  if (typeof HTMLCanvasElement.prototype.toDataURL !== 'function') {
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'
  }
}
