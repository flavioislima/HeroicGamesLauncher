import React, { useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { faFolderOpen } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { UpdateComponent } from 'frontend/components/UI'
import SettingsContext from '../../SettingsContext'
import './index.css'
import ContextProvider from 'frontend/state/ContextProvider'
import { GameInfo } from 'common/types'
import { openDiscordLink } from 'frontend/helpers'
import { faDiscord } from '@fortawesome/free-brands-svg-icons'
import useGlobalState from 'frontend/state/GlobalStateV2'
import Upload from '@mui/icons-material/Upload'
import Cloud from '@mui/icons-material/Cloud'
import classNames from 'classnames'

import type { GetLogFileArgs } from 'backend/logger/paths'

interface LogBoxProps {
  logFileContent: string
}

const LogBox: React.FC<LogBoxProps> = ({ logFileContent }) => {
  const { t } = useTranslation()
  const maxLines = 1000
  let sliced = false
  let lines = logFileContent.split('\n')
  if (lines.length > maxLines) {
    lines = ['...', ...lines.slice(-maxLines)]
    sliced = true
  }

  return (
    <>
      {sliced && (
        <span className="setting long-log-hint">
          {t(
            'settings.log.long-log-hint',
            'Log truncated, last 1000 lines are shown!'
          )}
        </span>
      )}
      <span className="setting log-box">
        {lines.map((line, key) => {
          if (line.toLowerCase().includes(' err')) {
            return (
              <p key={key} className="log-error">
                {line}
              </p>
            )
          } else if (line.toLowerCase().includes(' warn')) {
            return (
              <p key={key} className="log-warning">
                {line}
              </p>
            )
          } else {
            return (
              <p key={key} className="log-info">
                {line}
              </p>
            )
          }
        })}
      </span>
    </>
  )
}

export default function LogSettings() {
  const { t } = useTranslation()
  const { appName, runner } = useContext(SettingsContext)
  const { setUploadLogFileProps } = useGlobalState.keys('setUploadLogFileProps')
  const isInSettingsMenu = appName === 'default'

  const [logFileContent, setLogFileContent] = useState<string>('')
  const [logFileExist, setLogFileExist] = useState<boolean>(false)
  const [showLogOf, setShowLogOf] = useState<GetLogFileArgs>(
    !runner ? {} : { appName, runner }
  )
  const [refreshing, setRefreshing] = useState<boolean>(true)

  const { epic, gog, amazon, zoom, itchio, sideloadedLibrary } =
    useContext(ContextProvider)
  const [installedGames, setInstalledGames] = useState<GameInfo[]>([])

  useEffect(() => {
    let games: GameInfo[] = []
    games = games.concat(epic.library.filter((game) => game.is_installed))
    games = games.concat(gog.library.filter((game) => game.is_installed))
    games = games.concat(amazon.library.filter((game) => game.is_installed))
    games = games.concat(zoom.library.filter((game) => game.is_installed))
    games = games.concat(itchio.library.filter((game) => game.is_installed))
    games = games.concat(sideloadedLibrary.filter((game) => game.is_installed))
    games = games.sort((game1, game2) => game1.title.localeCompare(game2.title))

    setInstalledGames(games)
  }, [
    epic.library,
    gog.library,
    amazon.library,
    sideloadedLibrary,
    zoom.library,
    itchio.library
  ])

  const getLogContent = () => {
    void window.api.getLogContent(showLogOf).then((content: string) => {
      if (!content) {
        setLogFileContent(t('setting.log.no-file', 'No log file found.'))
        setLogFileExist(false)
        return setRefreshing(false)
      }
      setLogFileContent(content)
      setLogFileExist(true)
      setRefreshing(false)
    })
  }

  useEffect(() => {
    getLogContent()
    const interval = setInterval(() => {
      getLogContent()
    }, 1000)
    return () => clearInterval(interval)
  }, [showLogOf])

  function showLogFileInFolder() {
    window.api.showLogFileInFolder(showLogOf)
  }

  const descriptiveLogFileName = useMemo(() => {
    if (!showLogOf.runner)
      return t('setting.log.descriptiveNames.heroic', 'General Heroic log')
    if (showLogOf.appName) {
      const gameTitle = installedGames.find(
        ({ app_name }) => app_name === showLogOf.appName
      )?.title
      return t(
        'setting.log.descriptiveNames.game-log',
        'Game log of {{gameTitle}}',
        { gameTitle }
      )
    }
    if (showLogOf.runner === 'legendary')
      return t(
        'setting.log.descriptiveNames.legendary',
        'Epic Games / Legendary log'
      )
    if (showLogOf.runner === 'gog')
      return t('setting.log.descriptiveNames.gog', 'GOG log')
    if (showLogOf.runner === 'nile')
      return t('setting.log.descriptiveNames.nile', 'Amazon / Nile log')
    if (showLogOf.runner === 'zoom')
      return t('setting.log.descriptiveNames.zoom', 'Zoom log')
    if (showLogOf.runner === 'itchio')
      return t('setting.log.descriptiveNames.itchio', 'itch.io log')
    return ''
  }, [showLogOf, installedGames, t])

  const logFilesToShow = useMemo(() => {
    const baseFiles: { title: string; args: GetLogFileArgs }[] = [
      { title: 'Heroic', args: {} },
      { title: 'Epic/Legendary', args: { runner: 'legendary' } },
      { title: 'GOG', args: { runner: 'gog' } },
      { title: 'Amazon/Nile', args: { runner: 'nile' } }
    ]
    if (zoom.enabled) {
      baseFiles.push({ title: 'Zoom', args: { runner: 'zoom' } })
    }
    if (itchio.username) {
      baseFiles.push({ title: 'itch.io', args: { runner: 'itchio' } })
    }
    const logsForInstalledGames = installedGames.map((game) => ({
      title: game.title,
      args: {
        appName: game.app_name,
        runner: game.runner
      }
    }))
    return baseFiles.concat(logsForInstalledGames)
  }, [installedGames, zoom.enabled, itchio.username])

  return (
    <>
      <h3>{t('setting.log.instructions_title', 'How to report a problem?')}</h3>
      <p className="report-problem-instructions">
        {t(
          'setting.log.instructions',
          'Join our Discord and look for the "#-support" section. Read the pinned "Read Me First | Frequently Asked Questions" thread and follow the instructions to share these logs and any relevant information about your problem.'
        )}
      </p>
      <div
        className={classNames('logs-wrapper', {
          'game-log': !isInSettingsMenu
        })}
      >
        {isInSettingsMenu && (
          <span className="log-buttongroup">
            {logFilesToShow.map(({ title, args }, i) => {
              const isSelected =
                args.appName === showLogOf.appName &&
                args.runner === showLogOf.runner
              return (
                <a
                  key={i}
                  className={`log-buttons ${isSelected ? 'log-choosen' : ''}`}
                  onClick={() => {
                    setRefreshing(true)
                    setShowLogOf(args)
                  }}
                  title={title}
                >
                  {title}
                </a>
              )
            })}
          </span>
        )}

        {refreshing ? (
          <span className="setting log-box">
            <UpdateComponent />
          </span>
        ) : (
          <LogBox logFileContent={logFileContent} />
        )}
      </div>
      <span className="footerFlex">
        {logFileExist && (
          <>
            <a
              onClick={showLogFileInFolder}
              title={t('setting.log.show-in-folder', 'Show log file in folder')}
              className="button is-footer"
            >
              <div className="button-icontext-flex">
                <div className="button-icon-flex">
                  <FontAwesomeIcon icon={faFolderOpen} />
                </div>
                <span className="button-icon-text">
                  {t('setting.log.show-in-folder', 'Show log file in folder')}
                </span>
              </div>
            </a>
            <a
              onClick={() => {
                setUploadLogFileProps({
                  logFileArgs: showLogOf,
                  name: descriptiveLogFileName
                })
              }}
              title={t('setting.log.upload.button', 'Upload log file')}
              className="button is-footer"
            >
              <div className="button-icontext-flex">
                <div className="button-icon-flex">
                  <Upload />
                </div>
                <span className="button-icon-text">
                  {t('setting.log.upload.button', 'Upload log file')}
                </span>
              </div>
            </a>
            <a
              onClick={openDiscordLink}
              title={t('setting.log.join-heroic-discord', 'Join our Discord')}
              className="button is-footer"
            >
              <div className="button-icontext-flex">
                <div className="button-icon-flex">
                  <FontAwesomeIcon icon={faDiscord} />
                </div>
                <span className="button-icon-text">
                  {t('setting.log.join-heroic-discord', 'Join our Discord')}
                </span>
              </div>
            </a>
          </>
        )}
        {isInSettingsMenu && (
          <>
            <a
              onClick={() =>
                useGlobalState.setState({ showUploadedLogFileList: true })
              }
              title={t('setting.log.show-uploads', 'Show uploaded log files')}
              className="button is-footer"
            >
              <div className="button-icontext-flex">
                <div className="button-icon-flex">
                  <Cloud />
                </div>
                <span className="button-icon-text">
                  {t('setting.log.show-uploads', 'Show uploaded log files')}
                </span>
              </div>
            </a>
          </>
        )}
      </span>
    </>
  )
}
