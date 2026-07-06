/**
 * Root.jsx — Remotion composition entry point
 *
 * Registers the YZLogoReveal composition:
 *   • 4 seconds × 30 fps = 120 frames
 *   • 1920 × 1080 (16:9 Full HD)
 *
 * To preview:  npm run studio
 * To render:   npm run render
 */
import { Composition, registerRoot } from 'remotion'
import { LogoReveal } from './LogoReveal.jsx'

const RemotionRoot = () => (
  <Composition
    id="YZLogoReveal"
    component={LogoReveal}
    durationInFrames={120}
    fps={30}
    width={1920}
    height={1080}
  />
)

registerRoot(RemotionRoot)
