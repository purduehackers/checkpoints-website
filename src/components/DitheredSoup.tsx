// Same background art as the hack-night dashboard (purduehackers/hack-night-dashboard).
import { Dithering } from '@paper-design/shaders-react'

export function DitheredSoup({ fgColor = '#7e3cff' }: { fgColor?: string }) {
  return <Dithering className="absolute inset-0" width="100%" height="100%" colorBack="#000000" colorFront={fgColor} shape="warp" type="4x4" size={2} speed={0.04} scale={1} />
}
