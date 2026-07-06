import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

// ─── SVG path data for each letter ───────────────────────────────────────────
const YUKSELEN = [
  "M33.03,20.16l-7.45,19.27v11.28h-8.86v-11.28l-8.24-19.27h9.2l6.22,14.72,5.6-14.72h3.53Z",
  "M46.87,26.9v13.41c0,4.6-2.55,6.9-7.63,6.9s-7.6-2.3-7.6-6.9v-13.41h5.8v13.59c0,1.76.25,2.96.75,3.6.51.65,1.44.97,2.8.97,2.63,0,3.94-1.58,3.94-4.75v-13.41h1.95ZM36.5,21.28c1.59,0,2.38.64,2.38,1.92s-.79,1.93-2.38,1.93-2.4-.64-2.4-1.93.8-1.92,2.4-1.92ZM43.12,21.28c1.59,0,2.38.64,2.38,1.92s-.79,1.93-2.38,1.93-2.4-.64-2.4-1.93.79-1.92,2.4-1.92Z",
  "M65.4,26.9l-4.99,6.32,7.36,13.67h-6.46l-4.68-8.75-.83.93v7.82h-5.8v-19.99h5.8v8.91l6.88-8.91h2.72Z",
  "M82.32,32.5l-2.7.49c.12-.53.18-.98.18-1.34,0-2.32-1.41-3.49-4.23-3.49-2.23,0-3.34.8-3.34,2.4,0,1.2,1.25,2.23,3.73,3.09,4.8,1.65,7.2,4.09,7.2,7.32,0,1.9-.68,3.41-2.02,4.56-1.35,1.15-3.14,1.72-5.38,1.72-4.95,0-7.42-1.92-7.42-5.75,0-.31.02-.7.07-1.16l2.8-.62c-.22.85-.33,1.59-.33,2.21,0,2.48,1.43,3.72,4.26,3.72,2.28,0,3.41-.89,3.41-2.68,0-1.32-1.36-2.49-4.08-3.5-3.93-1.44-5.9-3.75-5.9-6.92,0-1.8.66-3.24,1.97-4.35,1.31-1.09,3.04-1.65,5.18-1.65,4.39,0,6.59,1.98,6.59,5.94Z",
  "M98.66,26.9v2.01h-7.16v6.05h6.02v2h-6.02v7.92h8.37v2.01h-14.17v-19.99h12.95Z",
  "M107.49,26.9v17.98h8.21v2.01h-14.01v-19.99h5.79Z",
  "M129.87,26.9v2.01h-7.15v6.05h6.02v2h-6.02v7.92h8.37v2.01h-14.17v-19.99h12.95Z",
  "M147.52,26.9v19.99h-4.44l-8.34-12.65v12.65h-1.95v-19.99h3.67l9.11,13.66v-13.66h1.95Z",
]

const ZEKA = [
  "M182.83,20.16v2.77l-14.68,24.71h13.59v3.07h-23.39v-3.07l14.51-24.42h-12.43v-3.06h22.41Z",
  "M195.54,26.9v2.01h-7.15v6.05h6.01v2h-6.01v7.92h8.37v2.01h-14.17v-19.99h12.95Z",
  "M213.96,26.9l-4.99,6.32,7.37,13.67h-6.46l-4.68-8.75-.84.93v7.82h-5.8v-19.99h5.8v8.91l6.88-8.91h2.72Z",
  "M226.9,26.9l5.56,19.99h-5.83l-1.18-4.33h-6.02l-1.28,4.33h-2.27l5.91-19.99h5.1ZM220.01,40.55h4.91l-2.36-8.86-2.54,8.86Z",
]

const EXPO_OUT = Easing.bezier(0.16, 1, 0.3, 1)
const SOFT_IN  = Easing.bezier(0.4, 0, 0.6, 1)

function ease(frame, inF, outF, easing) {
  return interpolate(frame, [inF, outF], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easing || EXPO_OUT,
  })
}

function Background({ frame }) {
  const opacity = ease(frame, 0, 20)
  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at 50% 55%, #1c1c2e 0%, #0d0d12 100%)',
        opacity,
      }}
    />
  )
}

function Letter({ d, frame, delay, color, isZeka }) {
  const progress = ease(frame, delay, delay + 22)
  const yOffset = interpolate(progress, [0, 1], [isZeka ? 18 : 12, 0])
  const opacity  = interpolate(progress, [0, 0.4, 1], [0, 0.65, 1])
  const scale    = interpolate(progress, [0, 1], [isZeka ? 1.08 : 1.04, 1])

  return (
    <path
      d={d}
      fill={color}
      style={{
        transformOrigin: 'center 35px',
        transform: `translateY(${yOffset}px) scale(${scale})`,
        opacity,
      }}
    />
  )
}

function ShineSweep({ frame, startFrame }) {
  const progress = ease(frame, startFrame, startFrame + 38, Easing.bezier(0.4, 0, 0.2, 1))
  const x = interpolate(progress, [0, 1], [-55, 295])
  const opacity = interpolate(progress, [0, 0.08, 0.85, 1], [0, 1, 1, 0])

  return (
    <rect
      x={x - 22}
      y={0}
      width={44}
      height={71}
      fill="url(#shineGrad)"
      style={{ opacity }}
    />
  )
}

function Divider({ frame, delay }) {
  const progress = ease(frame, delay, delay + 18)
  const opacity = interpolate(progress, [0, 1], [0, 0.3])
  return (
    <line
      x1={153}
      y1={24}
      x2={153}
      y2={47}
      stroke="#ffffff"
      strokeWidth={0.6}
      style={{
        opacity,
        transformOrigin: '153px 35px',
        transform: `scaleY(${progress})`,
      }}
    />
  )
}

function Tagline({ frame, delay }) {
  const progress = ease(frame, delay, delay + 28)
  const yOffset = interpolate(progress, [0, 1], [8, 0])
  const opacity  = interpolate(progress, [0, 1], [0, 0.5])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '21%',
        width: '100%',
        textAlign: 'center',
        fontFamily: "'Helvetica Neue', 'Arial', sans-serif",
        fontSize: 14,
        fontWeight: 300,
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.7)',
        opacity,
        transform: `translateY(${yOffset}px)`,
      }}
    >
      Yayın Takip
    </div>
  )
}

function FadeOut({ frame, startFrame, totalFrames }) {
  const opacity = interpolate(frame, [startFrame, totalFrames - 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: SOFT_IN,
  })
  return (
    <AbsoluteFill style={{ background: '#0d0d12', opacity, pointerEvents: 'none' }} />
  )
}

export function LogoAnimation() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()

  // Timing at 30fps:
  // 0-20   bg fade in
  // 18     Yükselen letters begin (stagger 8f each)
  // 52     ZEKA letters begin    (stagger 9f each)
  // 88     vertical divider
  // 100    shine sweep
  // 118    tagline
  // 150    fade-out begins
  // 180    end

  const COLOR      = '#f0eeec'
  const ZEKA_COLOR = '#ffffff'

  return (
    <AbsoluteFill style={{ backgroundColor: '#0d0d12' }}>
      <Background frame={frame} />

      {/* Radial vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 80% 70% at 50% 50%, transparent 35%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* Logo SVG */}
      <AbsoluteFill
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg
          viewBox="0 0 240.94 70.87"
          style={{ width: '58%', overflow: 'visible' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="shineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="white" stopOpacity={0} />
              <stop offset="50%"  stopColor="white" stopOpacity={0.8} />
              <stop offset="100%" stopColor="white" stopOpacity={0} />
            </linearGradient>
          </defs>

          {YUKSELEN.map((d, i) => (
            <Letter key={'y' + i} d={d} frame={frame} delay={18 + i * 8}  color={COLOR}      isZeka={false} />
          ))}

          <Divider frame={frame} delay={88} />

          {ZEKA.map((d, i) => (
            <Letter key={'z' + i} d={d} frame={frame} delay={52 + i * 9}  color={ZEKA_COLOR} isZeka={true}  />
          ))}

          <ShineSweep frame={frame} startFrame={100} />
        </svg>
      </AbsoluteFill>

      <Tagline frame={frame} delay={118} />

      <FadeOut frame={frame} startFrame={150} totalFrames={durationInFrames} />
    </AbsoluteFill>
  )
}
