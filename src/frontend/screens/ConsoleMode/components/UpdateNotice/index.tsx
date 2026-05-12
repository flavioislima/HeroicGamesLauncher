import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { BTN_BACK } from '../../controller'
import { useGamepadButtonPress } from '../../hooks'
import BackHint from '../BackHint'

import type { GameInfo } from 'common/types'

export default function UpdateNotice({
  game,
  onDismiss
}: {
  game: GameInfo
  onDismiss: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    // Read by gamepad.ts to block the global `back` action from navigating
    // away from /console while this modal is open.
    document.body.classList.add('console-modal-open')
    return () => document.body.classList.remove('console-modal-open')
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useGamepadButtonPress(BTN_BACK, onDismiss)

  return (
    <div
      className="consoleLaunchOverlay"
      role="alertdialog"
      aria-live="assertive"
      onClick={onDismiss}
    >
      <div className="consoleLaunchText">
        {t('console.update.title', 'Update required')}
      </div>
      <div className="consoleLaunchGameTitle">{game.title}</div>
      <p className="consoleUpdateNoticeBody">
        {t(
          'console.update.body',
          'This game has an update available. Please leave Console Mode and update the game before launching.'
        )}
      </p>
      <BackHint
        prefix={t('console.update.hintPrefix', 'Press')}
        suffix={t('console.update.hintSuffix', 'to go back')}
      />
    </div>
  )
}
