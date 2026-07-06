/**
 * LogoReveal.jsx — Yükselen Zeka professional logo reveal
 *
 * Timeline (30 fps):
 *
 *   Frame   0 ──────  18 ──────  32 ──────  50 ──────  65 ────── 105 ── 120
 *           │          │          │          │          │          │      │
 *         Mark      Wordmark   Divider   Tagline    Tagline     HOLD   END
 *        bounces    clip-wipe  draws in  fades in   settled
 *        in
 *
 * SWAP GUIDE — search "SWAP:" comments to replace placeholders with
 * your real assets (SVG icon, wordmark image, font, tagline text).
 */

import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Img,
  staticFile,
} from 'remotion'

// ─── TIMING CONSTANTS (frames at 30 fps) ─────────────────────────────────────
const T = {
  MARK_IN:     0,   // brand mark starts bouncing in         (~0.0 s)
  TEXT_IN:     20,  // wordmark clip-wipe starts             (~0.7 s)
  DIVIDER_IN:  46,  // horizontal rule draws across          (~1.5 s)
  TAG_IN:      62,  // tagline fades & rises in              (~2.1 s)
  HOLD:       105,  // everything is at rest — final frame   (~3.5 s)
}

// ─── SPRING CONFIGS ───────────────────────────────────────────────────────────
// BOUNCE  → playful, energetic entry for the mark (overshoots slightly)
// SMOOTH  → elegant settle for the wordmark & divider
// GENTLE  → soft, calm landing for the tagline
const BOUNCE = { damping: 9,  stiffness: 175, mass: 0.9 }
const SMOOTH = { damping: 20, stiffness: 150, mass: 1.0 }
const GENTLE = { damping: 28, stiffness: 110, mass: 1.0 }

// ─── BRAND COLORS ─────────────────────────────────────────────────────────────
// SWAP: Adjust these to match your exact brand palette.
const C = {
  // Background gradient (warm cream — premium children's brand feel)
  bgTop:   '#FFFEF8',
  bgMid:   '#FFFAEE',
  bgBot:   '#FFF3CC',
  // Mark
  gold:    '#F5B800',
  goldDk:  '#C8960A',
  // Wordmark text (only used in text-fallback mode)
  navy:    '#1A1A2E',
  teal:    '#0B5E44',
  // Divider
  divider: '#E8D8A0',
  // Tagline
  muted:   '#6B6B7E',
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAND MARK
// The circular icon badge that enters with a playful bounce spring.
//
// SWAP: Replace the entire <svg>…</svg> block below with your actual icon:
//
//   Option 1 — PNG/SVG file from your public/ folder:
//     <Img src={staticFile('yz_icon.png')} style={{ width: 120, height: 120 }} />
//
//   Option 2 — Your own inline SVG icon (just replace the paths).
// ─────────────────────────────────────────────────────────────────────────────
function BrandMark({ frame, fps }) {
  const sp = spring({ frame: frame - T.MARK_IN, fps, config: BOUNCE })

  const scale   = interpolate(sp, [0, 1], [0, 1],           { extrapolateRight: 'clamp' })
  const opacity = interpolate(sp, [0, 0.15, 1], [0, 1, 1],  { extrapolateRight: 'clamp' })
  const yOff    = interpolate(sp, [0, 1], [32, 0],          { extrapolateRight: 'clamp' })

  return (
    <div
      style={{
        transform:       `translateY(${yOff}px) scale(${scale})`,
        opacity,
        transformOrigin: 'center center',
        marginBottom:    24,
      }}
    >
      {/* ── Placeholder: sunrise / rising-light badge ── */}
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
        <defs>
          <radialGradient id="markGrad" cx="50%" cy="35%" r="65%">
            <stop offset="0%"   stopColor="#FFE040" />
            <stop offset="100%" stopColor={C.goldDk} />
          </radialGradient>
        </defs>

        {/* Outer soft glow ring */}
        <circle cx="60" cy="60" r="58" fill={C.gold} opacity={0.15} />

        {/* Main gold circle */}
        <circle cx="60" cy="60" r="50" fill="url(#markGrad)" />

        {/* White inner circle */}
        <circle cx="60" cy="60" r="40" fill="white" />

        {/* Rising rays — 5 bars, tallest in centre */}
        {[
          { angle: -24, h: 14 },
          { angle: -12, h: 18 },
          { angle:   0, h: 22 },
          { angle:  12, h: 18 },
          { angle:  24, h: 14 },
        ].map(({ angle, h }, i) => (
          <rect
            key={i}
            x={58.5}
            y={60 - h}
            width={3}
            height={h}
            rx={1.5}
            fill={C.gold}
            opacity={i === 2 ? 1 : 0.72}
            transform={`rotate(${angle} 60 60)`}
          />
        ))}

        {/* Sunrise arc (horizon line) */}
        <path
          d="M 26 66 A 34 34 0 0 1 94 66"
          stroke={C.gold}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />

        {/* Central sun dot */}
        <circle cx="60" cy="60" r="6" fill={C.gold} />
        <circle cx="60" cy="60" r="2.5" fill="white" />
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WORDMARK
// Reveals left-to-right with a clip-path wipe, paired with a gentle rise.
//
// SWAP: Replace the text-based version with your actual wordmark image:
//
//   <Img
//     src={staticFile('yz_blacklogo.svg')}   // or yz_whitelogo.svg
//     style={{ height: 60, width: 'auto' }}
//   />
//
// The clip-path wipe will still work on the <Img> element — no other
// changes needed.
// ─────────────────────────────────────────────────────────────────────────────
function Wordmark({ frame, fps }) {
  const sp = spring({ frame: frame - T.TEXT_IN, fps, config: SMOOTH })

  // Clip progresses from 0 % (fully hidden) → 100 % (fully revealed)
  const clipPct = interpolate(sp, [0, 1], [0, 100], { extrapolateRight: 'clamp' })
  const yOff    = interpolate(sp, [0, 1], [10, 0],  { extrapolateRight: 'clamp' })

  return (
    <div style={{ transform: `translateY(${yOff}px)` }}>
      {/*
       * clipPath shrinks right-edge inward until fully open.
       * Works identically whether the child is text or an <Img>.
       */}
      <div style={{ clipPath: `inset(0 ${100 - clipPct}% 0 0)` }}>

        {/* ── OPTION A: use your actual SVG wordmark (recommended) ── */}
        {/*
        <Img
          src={staticFile('yz_blacklogo.svg')}
          style={{ height: 62, width: 'auto', display: 'block' }}
        />
        */}

        {/* ── OPTION B: text-based placeholder (currently active) ── */}
        {/* SWAP: Replace the font with your brand typeface. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          {/* "Yükselen" — lighter tracking, teal */}
          <div style={{
            fontFamily:    "'Poppins', 'Helvetica Neue', Arial, sans-serif",
            fontSize:      22,
            fontWeight:    400,
            letterSpacing: '7px',
            color:         C.teal,
            textTransform: 'uppercase',
            lineHeight:    1,
            paddingLeft:   7, // compensate for letter-spacing on last char
          }}>
            Yükselen
          </div>

          {/* "ZEKA" — heavy display weight, navy */}
          <div style={{
            fontFamily:    "'Poppins', 'Helvetica Neue', Arial, sans-serif",
            fontSize:      72,
            fontWeight:    700,
            letterSpacing: '-2px',
            color:         C.navy,
            lineHeight:    1,
            marginTop:     2,
          }}>
            ZEKA
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DIVIDER
// A horizontal rule that draws from centre outward.
// ─────────────────────────────────────────────────────────────────────────────
function Divider({ frame, fps }) {
  const sp = spring({ frame: frame - T.DIVIDER_IN, fps, config: SMOOTH })

  const width   = interpolate(sp, [0, 1], [0, 300], { extrapolateRight: 'clamp' })
  const opacity = interpolate(sp, [0, 0.25, 1], [0, 1, 1], { extrapolateRight: 'clamp' })

  return (
    <div
      style={{
        width,
        height:  1.5,
        opacity,
        background: `linear-gradient(90deg, transparent 0%, ${C.divider} 30%, ${C.divider} 70%, transparent 100%)`,
        margin:  '20px 0 18px',
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAGLINE
// SWAP: Change the TAGLINE constant to your actual tagline text.
// ─────────────────────────────────────────────────────────────────────────────
const TAGLINE = 'Zekayı Geliştiren Eğlenceli Oyunlar'

function Tagline({ frame, fps }) {
  const sp = spring({ frame: frame - T.TAG_IN, fps, config: GENTLE })

  const opacity = interpolate(sp, [0, 0.5, 1], [0, 1, 1], { extrapolateRight: 'clamp' })
  const yOff    = interpolate(sp, [0, 1], [16, 0],        { extrapolateRight: 'clamp' })

  return (
    <div
      style={{
        opacity,
        transform:     `translateY(${yOff}px)`,
        fontFamily:    "'Poppins', 'Helvetica Neue', Arial, sans-serif",
        fontSize:      15,
        fontWeight:    300,
        letterSpacing: '3.5px',
        color:         C.muted,
        textTransform: 'uppercase',
        textAlign:     'center',
      }}
    >
      {TAGLINE}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND PARTICLES (optional polish — subtle floating dots)
// Remove this component and its usage below if you want a clean flat bg.
// ─────────────────────────────────────────────────────────────────────────────
const PARTICLES = [
  { x: 8,  y: 15, r: 4,   delay: 0  },
  { x: 92, y: 12, r: 3,   delay: 8  },
  { x: 5,  y: 70, r: 5,   delay: 4  },
  { x: 95, y: 75, r: 3.5, delay: 12 },
  { x: 15, y: 88, r: 4,   delay: 6  },
  { x: 85, y: 85, r: 3,   delay: 10 },
  { x: 50, y: 5,  r: 2.5, delay: 14 },
  { x: 50, y: 95, r: 2.5, delay: 2  },
]

function BackgroundParticles({ frame }) {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {PARTICLES.map((p, i) => {
        const localFrame = Math.max(0, frame - p.delay)
        const opacity = interpolate(localFrame, [0, 30], [0, 0.18], {
          extrapolateRight: 'clamp',
        })
        // Very slow float — purely decorative
        const yDrift = interpolate(frame, [0, 120], [0, -6])
        return (
          <div
            key={i}
            style={{
              position:     'absolute',
              left:         `${p.x}%`,
              top:          `${p.y}%`,
              width:        p.r * 2,
              height:       p.r * 2,
              borderRadius: '50%',
              background:   C.gold,
              opacity,
              transform:    `translateY(${yDrift * (i % 2 === 0 ? 1 : -1)}px)`,
            }}
          />
        )
      })}
    </AbsoluteFill>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
export function LogoReveal() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(165deg, ${C.bgTop} 0%, ${C.bgMid} 50%, ${C.bgBot} 100%)`,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
      }}
    >
      {/* Floating accent particles in corners */}
      <BackgroundParticles frame={frame} />

      {/* Logo mark — bounces in first */}
      <BrandMark frame={frame} fps={fps} />

      {/* Wordmark — clip-wipe reveal */}
      <Wordmark frame={frame} fps={fps} />

      {/* Thin gold divider */}
      <Divider frame={frame} fps={fps} />

      {/* Tagline — gentle fade + rise */}
      <Tagline frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}
