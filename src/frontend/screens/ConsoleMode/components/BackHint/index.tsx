import classNames from 'classnames'
import { useGamepadInfo } from '../../hooks'
import { getBackButtonLabel } from '../../controller'

export default function BackHint({
  prefix,
  suffix,
  active
}: {
  prefix: string
  suffix: string
  active?: boolean
}) {
  const { connected: gamepadConnected, layout: controllerLayout } =
    useGamepadInfo()
  const backButtonLabel = getBackButtonLabel(controllerLayout)

  return (
    <div className={classNames('consoleLaunchHint', { active })}>
      {prefix} <kbd>{gamepadConnected ? backButtonLabel : 'Esc'}</kbd> {suffix}
    </div>
  )
}
