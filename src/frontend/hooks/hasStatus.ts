import React from 'react'
import ContextProvider from 'frontend/state/ContextProvider'
import { GameInfo, GameStatus, Status } from 'common/types'
import { hasProgress } from './hasProgress'
import { useTranslation } from 'react-i18next'
import { getStatusLabel, handleNonAvailableGames } from './constants'

export function hasStatus(gameInfo: GameInfo, gameSize?: string) {
  const appName = gameInfo.app_name
  const { libraryStatus, epic, gog } = React.useContext(ContextProvider)
  const [progress] = hasProgress(gameInfo.app_name, gameInfo.runner)
  const [newGameInfo, setNewGameInfo] = React.useState<GameInfo | undefined>(
    gameInfo
  )
  const { t } = useTranslation('gamepage')

  const [gameStatus, setGameStatus] = React.useState<{
    status?: Status
    statusContext?: string
    folder?: string
    label: string
  }>({ label: '' })

  const {
    thirdPartyManagedApp = undefined,
    is_installed,
    runner = 'sideload',
    isEAManaged,
    isUbisoftManaged
  } = { ...newGameInfo }

  React.useEffect(() => {
    // Sync with the prop whenever it changes — otherwise an uninstall that
    // flips `is_installed` to false in the parent's library state is never
    // observed here, leaving the card stuck on the previous status.
    if (gameInfo) {
      setNewGameInfo(gameInfo)
      return
    }
    const fetchGameInfo = async () => {
      const updatedInfo = await window.api.getGameInfo(
        appName,
        runner || 'sideload'
      )
      if (updatedInfo) {
        setNewGameInfo(updatedInfo)
      }
    }
    fetchGameInfo()
  }, [appName, gameInfo])

  React.useEffect(() => {
    const checkGameStatus = async () => {
      const {
        status,
        folder,
        context: statusContext
      } = libraryStatus.find((game: GameStatus) => game.appName === appName) ||
      {}

      if (status && status !== 'done') {
        const label = getStatusLabel({
          status,
          t,
          runner,
          size: gameSize,
          statusContext,
          percent: progress.percent
        })
        return setGameStatus({ status, folder, label, statusContext })
      }

      if (thirdPartyManagedApp && !isEAManaged && !isUbisoftManaged) {
        const label = getStatusLabel({
          status: 'notSupportedGame',
          t,
          runner
        })
        return setGameStatus({
          status: 'notSupportedGame',
          label,
          statusContext
        })
      }

      if (is_installed && !thirdPartyManagedApp) {
        const gameAvailable = await handleNonAvailableGames(appName, runner)
        if (!gameAvailable) {
          const label = getStatusLabel({
            status: 'notAvailable',
            t,
            runner
          })
          return setGameStatus({ status: 'notAvailable', label, statusContext })
        }
        const label = getStatusLabel({
          status: 'installed',
          t,
          runner,
          size: gameSize
        })
        return setGameStatus({ status: 'installed', label, statusContext })
      }

      const label = getStatusLabel({
        status: 'notInstalled',
        t,
        runner
      })
      return setGameStatus({ status: 'notInstalled', label, statusContext })
    }
    checkGameStatus()
  }, [
    libraryStatus,
    appName,
    epic.library,
    gog.library,
    is_installed,
    progress.percent
  ])

  return gameStatus
}
