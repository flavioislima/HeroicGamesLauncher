import './index.css'

import { useContext, useEffect, useState } from 'react'

import { DMQueueElement, DownloadManagerState } from 'common/types'
import StopIcon from 'frontend/assets/stop-icon.svg?react'
import { CachedImage, SvgButton } from 'frontend/components/UI'
import { handleStopInstallation } from 'frontend/helpers/library'
import { getGameInfo, getStoreName } from 'frontend/helpers'
import { useTranslation } from 'react-i18next'
import { hasProgress } from 'frontend/hooks/hasProgress'
import ContextProvider from 'frontend/state/ContextProvider'
import { useNavigate } from 'react-router-dom'
import PlayIcon from 'frontend/assets/play-icon.svg?react'
import PauseIcon from 'frontend/assets/pause-icon.svg?react'

type Props = {
  element?: DMQueueElement
  current: boolean
  state?: DownloadManagerState
  handleClearItem?: (appName: string) => void
}

const options: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: 'numeric'
}

function convertToTime(time: number) {
  const date = time ? new Date(time) : new Date()
  const hour = new Intl.DateTimeFormat(undefined, options).format(date)
  return {
    hour,
    date: date.toLocaleDateString(),
    fullDate: date.toLocaleString()
  }
}

const DownloadManagerItem = ({
  element,
  current,
  state,
  handleClearItem
}: Props) => {
  const { amazon, epic, gog, itchio, showDialogModal } =
    useContext(ContextProvider)
  const { t } = useTranslation('gamepage')
  const { t: t2 } = useTranslation('translation')
  const isPaused = state && ['idle', 'paused'].includes(state)

  const navigate = useNavigate()

  if (!element) {
    return (
      <h5 style={{ paddingTop: 'var(--space-xs' }}>
        {t2('queue.label.empty', 'Nothing to download')}
      </h5>
    )
  }

  const library = [
    ...epic.library,
    ...gog.library,
    ...amazon.library,
    ...itchio.library
  ]

  const { params, addToQueueTime, endTime, type, startTime } = element
  const {
    appName,
    runner,
    path,
    gameInfo: DmGameInfo,
    size,
    platformToInstall
  } = params

  const [gameInfo, setGameInfo] = useState(DmGameInfo)

  useEffect(() => {
    const getNewInfo = async () => {
      const newInfo = await getGameInfo(appName, runner)
      if (newInfo && newInfo.runner !== 'sideload') {
        setGameInfo(newInfo)
      }
    }
    getNewInfo()
  }, [element])

  const {
    art_cover,
    art_square,
    install: { is_dlc }
  } = gameInfo || {}

  const [progress] = hasProgress(appName, runner)
  const { status } = element
  const finished = status === 'done'
  const canceled = status === 'error' || (status === 'abort' && !current)

  const stopInstallation = async () => {
    if (!gameInfo) {
      return
    }
    const folder_name = gameInfo.folder_name
    if (!folder_name) return

    return handleStopInstallation(
      appName,
      path,
      t,
      progress,
      runner,
      showDialogModal
    )
  }

  const goToGamePage = () => {
    if (is_dlc) {
      return
    }
    return navigate(`/gamepage/${runner}/${appName}`, {
      state: { fromDM: true, gameInfo: gameInfo }
    })
  }

  // using one element for the different states so it doesn't
  // lose focus from the button when using a game controller
  const handleMainActionClick = () => {
    if (finished) {
      return goToGamePage()
    } else if (canceled && handleClearItem) {
      handleClearItem(appName)
    }

    if (current) stopInstallation()
    else window.api.removeFromDMQueue(appName)
  }

  // using one element for the different states so it doesn't
  // lose focus from the button when using a game controller
  const handleSecondaryActionClick = () => {
    if (isPaused) {
      window.api.resumeCurrentDownload()
    } else if (state === 'running') {
      window.api.pauseCurrentDownload()
    }
  }

  const mainActionIcon = () => {
    if (finished) {
      if (is_dlc) {
        return <>-</>
      }
      return <PlayIcon className="playIcon" />
    }

    if (canceled) {
      return <StopIcon className="installIcon" />
    }

    return <StopIcon className="cancelIcon" />
  }

  const secondaryActionIcon = () => {
    if (isPaused) {
      return <PlayIcon className="playIcon" />
    } else if (state === 'running') {
      return <PauseIcon className="pauseIcon" />
    } else {
      return <></>
    }
  }

  const getTime = () => {
    if (finished) {
      return convertToTime(endTime)
    }
    if (current) {
      return convertToTime(startTime)
    }
    return convertToTime(addToQueueTime)
  }

  const mainIconTitle = () => {
    const { status } = element
    if (status === 'done' || status === 'error') {
      return t('Open')
    }

    return current
      ? t('button.cancel', 'Cancel')
      : t('queue.label.remove', 'Remove from Downloads')
  }

  const secondaryIconTitle = () => {
    if (isPaused) {
      return t('queue.label.resume', 'Resume download')
    } else if (state === 'running') {
      return t('queue.label.pause', 'Pause download')
    } else {
      return ''
    }
  }

  const getStatusColor = () => {
    if (element.status === 'done') {
      return 'var(--success)'
    }

    if (canceled) {
      return 'var(--cancel-button, var(--danger))'
    }

    return current ? 'var(--text-default)' : 'var(--accent)'
  }

  const currentApp = library.find(
    (val) => val.app_name === appName && val.runner === runner
  )

  if (!currentApp) {
    return null
  }

  const { title } = currentApp
  const cover = art_cover || art_square

  const translatedTypes = {
    install: t2('download-manager.install-type.install', 'Install'),
    update: t2('download-manager.install-type.update', 'Update')
  }

  const { fullDate, hour, date } = getTime()

  return (
    <div className="downloadManagerListItem">
      <span
        role="button"
        onClick={() => goToGamePage()}
        className="downloadManagerTitleList"
        style={{
          color: getStatusColor(),
          cursor: is_dlc ? 'default' : 'pointer'
        }}
      >
        {cover && <CachedImage src={cover} alt={title} />}
        <span className="titleSize">
          {title}
          <span title={path}>
            {size ?? ''} |{' '}
            {platformToInstall === 'osx' ? 'Mac' : platformToInstall}
            {canceled ? ` (${t('queue.label.canceled', 'Canceled')})` : ''}
          </span>
        </span>
      </span>
      <span title={fullDate}>
        {date} {hour}
      </span>
      <span>{translatedTypes[type]}</span>
      <span>{getStoreName(runner, t2('Other'))}</span>
      <span className="icons">
        <SvgButton onClick={handleMainActionClick} title={mainIconTitle()}>
          {mainActionIcon()}
        </SvgButton>
        {current && (
          <SvgButton
            onClick={handleSecondaryActionClick}
            title={secondaryIconTitle()}
          >
            {secondaryActionIcon()}
          </SvgButton>
        )}
      </span>
    </div>
  )
}

export default DownloadManagerItem
