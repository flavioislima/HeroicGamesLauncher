import { Runner } from 'common/types'
import EpicLogo from 'frontend/assets/epic-logo.svg?react'
import GOGLogo from 'frontend/assets/gog-logo.svg?react'
import SideLoad from 'frontend/assets/heroic-icon.svg?react'
import AmazonLogo from 'frontend/assets/amazon-logo.svg?react'
import ZoomLogo from 'frontend/assets/zoom-logo.svg?react'
import HumbleLogo from 'frontend/assets/humble-logo.svg?react'

type Props = { runner: Runner; className?: string }

export default function StoreLogos({
  runner,
  className = 'store-icon'
}: Props) {
  switch (runner) {
    case 'legendary':
      return <EpicLogo className={className} />
    case 'gog':
      return <GOGLogo className={className} />
    case 'nile':
      return <AmazonLogo className={className} />
    case 'zoom':
      return <ZoomLogo className={className} />
    case 'humble':
      return <HumbleLogo className={className} />
    default:
      return <SideLoad className={className} />
  }
}
