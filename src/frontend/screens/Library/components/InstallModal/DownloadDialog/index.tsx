import {
  faDownload,
  faHardDrive,
  faSpinner
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import classNames from 'classnames'
import { Tooltip } from '@mui/material'
import {
  GameInfo,
  GameStatus,
  InstallInfo,
  InstallPlatform,
  Runner,
  WineInstallation
} from 'common/types'
import {
  SelectiveDownload,
  DLCInfo as LegendaryDLCInfo
} from 'common/types/legendary'
import { BuildItem, DLCInfo as GOGDLCInfo } from 'common/types/gog'
import { PathSelectionBox, ToggleSwitch } from 'frontend/components/UI'
import Anticheat from 'frontend/components/UI/Anticheat'
import {
  DialogHeader,
  DialogFooter,
  DialogContent
} from 'frontend/components/UI/Dialog'
import {
  getProgress,
  size,
  getInstallInfo,
  writeConfig,
  install,
  getPreferredInstallLanguage
} from 'frontend/helpers'
import ContextProvider from 'frontend/state/ContextProvider'
import { InstallProgress } from 'frontend/types'
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AvailablePlatforms } from '../index'
import { configStore } from 'frontend/helpers/electronStores'
import DLCDownloadListing from './DLCDownloadListing'
import BuildSelector from './BuildSelector'
import GameLanguageSelector from './GameLanguageSelector'
import { hasAnticheatInfo } from 'frontend/hooks/hasAnticheatInfo'
import BranchSelector from './BranchSelector'
import { openInstallGameModal } from 'frontend/state/InstallGameModal'

interface Props {
  backdropClick: () => void
  appName: string
  runner: Runner
  platformToInstall: InstallPlatform
  availablePlatforms: AvailablePlatforms
  winePrefix: string
  crossoverBottle: string
  wineVersion: WineInstallation | undefined
  children: React.ReactNode
  gameInfo: GameInfo
}

type DiskSpaceInfo = {
  notEnoughDiskSpace: boolean
  message: string
  validPath: boolean
  validFlatpakPath: boolean
  spaceLeftAfter: string
}

const storage: Storage = window.localStorage

function getUniqueKey(sdl: SelectiveDownload) {
  if (sdl.tags) {
    return sdl.tags.join(',')
  }
  return ''
}

const userHome = configStore.get('userHome', '')

function getDefaultInstallPath() {
  const { defaultInstallPath = `${userHome}/Games/Heroic` } = {
    ...configStore.get_nodefault('settings')
  }
  return defaultInstallPath
}

export default function DownloadDialog({
  backdropClick,
  appName,
  runner,
  platformToInstall,
  availablePlatforms,
  winePrefix,
  wineVersion,
  children,
  gameInfo,
  crossoverBottle
}: Props) {
  const previousProgress = JSON.parse(
    storage.getItem(appName) || '{}'
  ) as InstallProgress
  const { libraryStatus, platform, showDialogModal } =
    useContext(ContextProvider)

  const isWin = platform === 'win32'

  const [gameInstallInfo, setGameInstallInfo] = useState<InstallInfo | null>(
    null
  )
  const [installLanguages, setInstallLanguages] = useState(Array<string>())
  const [installLanguage, setInstallLanguage] = useState('')

  const [diskSize, setDiskSize] = useState(0)

  const [gameBuilds, setBuilds] = useState<BuildItem[]>([])
  const [selectedBuild, setSelectedBuild] = useState<string | undefined>()

  const [savedBranchPassword, setSavedBranchPassword] = useState<string>('')
  const [branches, setBranches] = useState<Array<string | null>>([])
  const [branch, setBranch] = useState<string | undefined>()

  const [installPath, setInstallPath] = useState(
    previousProgress.folder || getDefaultInstallPath()
  )
  const gameStatus: GameStatus = libraryStatus.filter(
    (game: GameStatus) => game.appName === appName
  )[0]

  const [dlcsToInstall, setDlcsToInstall] = useState<string[]>([])
  const [sdls, setSdls] = useState<SelectiveDownload[]>([])
  const [selectedSdls, setSelectedSdls] = useState<{ [key: string]: boolean }>(
    {}
  )
  const [gettingInstallInfo, setGettingInstallInfo] = useState(false)

  const installFolder = gameStatus?.folder || installPath

  const [spaceLeft, setSpaceLeft] = useState<DiskSpaceInfo>({
    message: '',
    notEnoughDiskSpace: false,
    validPath: true,
    validFlatpakPath: true,
    spaceLeftAfter: ''
  })

  const anticheatInfo = hasAnticheatInfo(gameInfo)

  const { i18n, t } = useTranslation('gamepage')
  const { t: tr } = useTranslation()

  const haveSDL = sdls.length > 0

  const sdlList = useMemo(() => {
    const list = []
    if (haveSDL) {
      for (const sdl of sdls) {
        if (sdl.required || selectedSdls[getUniqueKey(sdl)]) {
          if (Array.isArray(sdl.tags)) {
            list.push(...sdl.tags)
          }
        }
      }
    }
    return list
  }, [selectedSdls, sdls])

  useEffect(() => {
    async function get() {
      const branchPassword = await window.api.getPrivateBranchPassword(
        gameInfo.app_name
      )
      setSavedBranchPassword(branchPassword)
    }
    get()
  }, [])

  const handleSdl = useCallback(
    (sdl: SelectiveDownload, value: boolean) => {
      setSelectedSdls({
        ...selectedSdls,
        [getUniqueKey(sdl)]: value
      })
    },
    [selectedSdls]
  )

  async function confirmInstallBrokenAnticheat(path?: string) {
    const { allowInstallationBrokenAnticheat } =
      await window.api.requestAppSettings()
    const title = t(
      'install.anticheat-warning.title',
      'Anticheat Broken/Denied'
    )
    if (allowInstallationBrokenAnticheat) {
      showDialogModal({
        title,
        message: t(
          'install.anticheat-warning.multiplayer_message',
          'The anticheat support is broken or denied. The game may open but the multiplayer features will not work. Do you want to install it anyway?'
        ),
        buttons: [
          {
            text: t(
              'install.anticheat-warning.install_anyway',
              'Yes (I understand the multiplayer features will not work)'
            ),
            onClick: async () => handleInstall(path, true)
          },
          {
            text: t('install.anticheat-warning.cancel', 'No'),
            onClick: () => null
          }
        ]
      })
    } else {
      showDialogModal({
        title,
        message: (
          <Trans
            key="install.anticheat-warning.disabled_installation"
            i18n={i18n}
          >
            This game uses anticheat software that is not compatible with your
            operating system or the support was not enabled by the game
            developers. This means that the multiplayer features will not work,
            and there is nothing you (or the Heroic team) can do about it.
            <br />
            <br />
            To install this game and try it anyway, go to Settings, Advanced,
            and check the option to allow the installation of games with broken
            or denied anticheat.
            <br />
            <br />
            Note that there is no solution for this and you will risk getting
            banned in the game.
          </Trans>
        ),
        buttons: [
          {
            text: t('install.anticheat-warning.ok', 'Ok'),
            onClick: () => null
          }
        ]
      })
    }
  }

  async function handleInstall(path?: string, ignoreAnticheat = false) {
    if (
      anticheatInfo &&
      ['Denied', 'Broken', 'Unknown'].includes(anticheatInfo.status)
    ) {
      if (!ignoreAnticheat) {
        confirmInstallBrokenAnticheat(path)
        return
      }
    }

    backdropClick()

    // Write Default game config with prefix on linux
    if (!isWin) {
      const gameSettings = await window.api.requestGameSettings(appName)

      if (wineVersion) {
        writeConfig({
          appName,
          config: {
            ...gameSettings,
            winePrefix,
            wineVersion,
            wineCrossoverBottle: crossoverBottle
          }
        })
      }
    }

    return install({
      gameInfo,
      installPath: path || installFolder,
      isInstalling: false,
      previousProgress,
      progress: previousProgress,
      t,
      sdlList,
      installDlcs: dlcsToInstall,
      installLanguage,
      platformToInstall,
      build: selectedBuild,
      branch,
      showDialogModal: () => backdropClick()
    })
  }

  function handleSwitchToImport() {
    backdropClick()
    openInstallGameModal({
      appName,
      runner,
      gameInfo,
      action: 'import'
    })
  }

  useEffect(() => {
    const getInstInfo = async () => {
      try {
        const fetchedPlatform = platformToInstall
        const fetchedBuild = selectedBuild
        setGettingInstallInfo(true)
        const gameInstallInfo = await getInstallInfo(
          appName,
          runner,
          platformToInstall,
          selectedBuild,
          branch
        )

        if (
          gameInstallInfo?.manifest &&
          gameInstallInfo?.manifest.disk_size === 0 &&
          gameInstallInfo.manifest.download_size === 0
        ) {
          showDialogModal({
            showDialog: true,
            title: t(
              'label.game.not-installable-game',
              'Game is NOT Installable'
            ),
            message: t(
              'status.gog-goodie',
              "This game doesn't appear to be installable. Check downloadable content on https://gog.com/account"
            ),
            buttons: [
              {
                text: tr('box.ok')
              }
            ],
            type: 'MESSAGE'
          })
          backdropClick()
          return
        }

        setGameInstallInfo(gameInstallInfo)
        setGettingInstallInfo(false)

        // Prevent condition when user changes the platform before we reach this point
        if (
          platformToInstall !== fetchedPlatform ||
          fetchedBuild !== selectedBuild
        ) {
          return
        }
        const dlcs: string[] = []
        if (
          gameInstallInfo &&
          'game' in gameInstallInfo &&
          gameInstallInfo.game.owned_dlc
        ) {
          gameInstallInfo.game.owned_dlc.forEach((dlc) =>
            dlcs.push(dlc.app_name)
          )
        }
        setDlcsToInstall(dlcs)
        if (gameInstallInfo && gameInstallInfo.manifest) {
          setDiskSize(gameInstallInfo.manifest?.disk_size ?? 0)
        }

        if (gameInstallInfo) {
          if (
            gameInstallInfo.manifest &&
            'builds' in gameInstallInfo.manifest
          ) {
            const builds = (gameInstallInfo.manifest.builds || [])
              .filter(
                // We either take branch when both are falsy (null | undefined)
                // or when they are equal
                (build) => (!branch && !build.branch) || build.branch === branch
              )
              .sort(
                (a, b) =>
                  new Date(b.date_published).getTime() -
                  new Date(a.date_published).getTime()
              )
            setBuilds(builds)
          }

          if (
            gameInstallInfo.manifest &&
            'languages' in gameInstallInfo.manifest
          ) {
            setInstallLanguages(gameInstallInfo.manifest.languages.sort())
            if (!gameInstallInfo.manifest.languages.includes(installLanguage)) {
              setInstallLanguage(
                getPreferredInstallLanguage(
                  gameInstallInfo.manifest.languages,
                  i18n.languages
                )
              )
            }
          }

          if (
            gameInstallInfo.manifest &&
            'game' in gameInstallInfo &&
            'branches' in gameInstallInfo.game
          ) {
            setBranches(gameInstallInfo.game.branches || [])
          }
        }
      } catch (error) {
        showDialogModal({
          type: 'ERROR',
          title: tr('box.error.generic.title', 'Error!'),
          message: `${tr('box.error.generic.message', 'Something Went Wrong!')}
          ${error}`
        })
        backdropClick()
        return
      }
    }
    void getInstInfo()
  }, [
    appName,
    i18n.languages,
    platformToInstall,
    selectedBuild,
    branch,
    savedBranchPassword
  ])

  useEffect(() => {
    const getGameSdl = async () => {
      if (runner === 'legendary') {
        const { sdl_config } = await window.api.getGameOverride()
        if (sdl_config && sdl_config[appName]) {
          const sdl = await window.api.getGameSdl(appName)
          if (sdl.length > 0) {
            setSdls(sdl)
          }
        }
      }
    }
    getGameSdl()
  }, [appName, runner])

  useEffect(() => {
    const getSpace = async () => {
      const { message, free, validPath, validFlatpakPath } =
        await window.api.checkDiskSpace(installPath)
      if (diskSize) {
        let notEnoughDiskSpace = free < diskSize
        let spaceLeftAfter = size(free - Number(diskSize))
        if (previousProgress.folder === installPath) {
          const progress = 100 - getProgress(previousProgress)
          notEnoughDiskSpace = free < (progress / 100) * diskSize

          spaceLeftAfter = size(free - (progress / 100) * diskSize)
        }

        setSpaceLeft({
          message,
          notEnoughDiskSpace,
          validPath,
          validFlatpakPath,
          spaceLeftAfter
        })
      }
    }
    getSpace()
  }, [installPath, diskSize])

  const haveDLCs =
    gameInstallInfo &&
    'game' in gameInstallInfo &&
    gameInstallInfo?.game?.owned_dlc?.length > 0
  const DLCList: Array<GOGDLCInfo | LegendaryDLCInfo> =
    (gameInstallInfo &&
      'game' in gameInstallInfo &&
      gameInstallInfo?.game?.owned_dlc) ||
    []

  const downloadSize = useMemo(() => {
    if (
      gameInstallInfo &&
      gameInstallInfo.manifest &&
      'perLangSize' in gameInstallInfo.manifest &&
      gameInstallInfo.manifest.perLangSize
    ) {
      const languageSize =
        gameInstallInfo?.manifest?.perLangSize[installLanguage]
          ?.download_size ?? 0
      const universalSize =
        gameInstallInfo?.manifest?.perLangSize['*']?.download_size ?? 0

      const dlcSize = DLCList.reduce((acc, dlc) => {
        if (dlcsToInstall.includes(dlc.app_name) && 'perLangSize' in dlc) {
          const languageSize =
            dlc.perLangSize[installLanguage]?.download_size ?? 0
          const universalSize = dlc.perLangSize['*']?.download_size ?? 0
          acc += languageSize + universalSize
        }
        return acc
      }, 0 as number)

      return size(languageSize + universalSize + dlcSize)
    }
    if (gameInstallInfo?.manifest?.download_size) {
      if (previousProgress.folder === installPath) {
        const progress = 100 - getProgress(previousProgress)
        return size(
          (progress / 100) * Number(gameInstallInfo.manifest.disk_size)
        )
      }

      return size(Number(gameInstallInfo?.manifest?.download_size))
    }
    return ''
  }, [installPath, gameInstallInfo, installLanguage, dlcsToInstall])

  const installSize = useMemo(() => {
    if (
      gameInstallInfo &&
      gameInstallInfo.manifest &&
      'perLangSize' in gameInstallInfo.manifest &&
      gameInstallInfo.manifest.perLangSize
    ) {
      const languageSize =
        gameInstallInfo?.manifest?.perLangSize[installLanguage]?.disk_size ?? 0
      const universalSize =
        gameInstallInfo?.manifest?.perLangSize['*']?.disk_size ?? 0
      const dlcSize = DLCList.reduce((acc, dlc) => {
        if (dlcsToInstall.includes(dlc.app_name) && 'perLangSize' in dlc) {
          const languageSize = dlc.perLangSize[installLanguage]?.disk_size ?? 0
          const universalSize = dlc.perLangSize['*']?.disk_size ?? 0
          acc += languageSize + universalSize
        }
        return acc
      }, 0)
      setDiskSize(languageSize + universalSize + dlcSize)
      return size(languageSize + universalSize + dlcSize)
    }

    if (gameInstallInfo?.manifest?.disk_size) {
      return size(Number(gameInstallInfo?.manifest?.disk_size))
    }

    return ''
  }, [gameInstallInfo, installLanguage, platformToInstall, dlcsToInstall])

  const {
    validPath,
    validFlatpakPath,
    notEnoughDiskSpace,
    message,
    spaceLeftAfter
  } = spaceLeft
  const title = gameInfo?.title

  function getInstallLabel() {
    if (installPath) {
      if (notEnoughDiskSpace) {
        return t('button.force-innstall', 'Force Install')
      } else {
        return previousProgress.folder === installPath
          ? t('button.continue', 'Continue Download')
          : t('button.install')
      }
    }
    return t('button.no-path-selected', 'No path selected')
  }

  const readyToInstall =
    installPath && !!diskSize && !gettingInstallInfo && validFlatpakPath

  const showDlcSelector =
    ['legendary', 'gog'].includes(runner) && DLCList && DLCList?.length > 0

  return (
    <>
      <DialogHeader onClose={backdropClick}>
        {title ? title : '...'}
        {availablePlatforms.map((p) => (
          <FontAwesomeIcon
            className="InstallModal__platformIcon"
            icon={p.icon}
            key={p.value}
          />
        ))}
      </DialogHeader>
      <Anticheat anticheatInfo={anticheatInfo} />
      <DialogContent>
        <div className="InstallModal__sizes">
          <div className="InstallModal__size">
            <FontAwesomeIcon
              className={classNames('InstallModal__sizeIcon', {
                'fa-spin-pulse': !downloadSize
              })}
              icon={downloadSize ? faDownload : faSpinner}
            />
            {downloadSize ? (
              <>
                <div className="InstallModal__sizeLabel">
                  {t('game.downloadSize', 'Download Size')}:
                </div>
                <div className="InstallModal__sizeValue">{downloadSize}</div>
              </>
            ) : (
              `${t('game.getting-download-size', 'Geting download size')}...`
            )}
          </div>
          <div className="InstallModal__size">
            <FontAwesomeIcon
              className={classNames('InstallModal__sizeIcon', {
                'fa-spin-pulse': !downloadSize
              })}
              icon={downloadSize ? faHardDrive : faSpinner}
            />
            {downloadSize ? (
              <>
                <div className="InstallModal__sizeLabel">
                  {t('game.installSize', 'Install Size')}:
                </div>
                <div className="InstallModal__sizeValue">{installSize}</div>
              </>
            ) : (
              `${t('game.getting-install-size', 'Geting install size')}...`
            )}
          </div>
          {previousProgress.folder === installPath && (
            <div className="InstallModal__size">
              <FontAwesomeIcon
                className="InstallModal__sizeIcon"
                icon={faSpinner}
              />
              <div className="InstallModal__sizeLabel">
                {t('status.totalDownloaded', 'Total Downloaded')}:
              </div>
              <div className="InstallModal__sizeValue">
                {getProgress(previousProgress)}%
              </div>
            </div>
          )}
        </div>
        {installLanguages && installLanguages?.length > 1 && (
          <GameLanguageSelector
            installPlatform={platformToInstall}
            installLanguage={installLanguage}
            setInstallLanguage={setInstallLanguage}
            installLanguages={installLanguages}
          />
        )}

        <PathSelectionBox
          type="directory"
          onPathChange={setInstallPath}
          path={installPath}
          placeholder={getDefaultInstallPath()}
          pathDialogTitle={t('install.path')}
          pathDialogDefaultPath={getDefaultInstallPath()}
          htmlId="setinstallpath"
          label={t('install.path', 'Select Install Path')}
          noDeleteButton
          afterInput={
            downloadSize ? (
              <span className="smallInputInfo">
                {validPath && validFlatpakPath && (
                  <>
                    <span>
                      {`${t('install.disk-space-left', 'Space Available')}: `}
                    </span>
                    <span>
                      <strong>{`${message}`}</strong>
                    </span>
                    {!notEnoughDiskSpace && (
                      <>
                        <span>
                          {` - ${t(
                            'install.space-after-install',
                            'After Install'
                          )}: `}
                        </span>
                        <span>
                          <strong>{`${spaceLeftAfter}`}</strong>
                        </span>
                      </>
                    )}
                  </>
                )}
                {!validPath && (
                  <span className="warning">
                    {`${t(
                      'install.path-not-writtable',
                      'Warning: path might not be writable.'
                    )}`}
                  </span>
                )}
                {validPath && !validFlatpakPath && (
                  <span className="error">
                    {`${t(
                      'install.flatpak-path-not-writtable',
                      'Error: Sandbox access not granted to this path, data loss will occur.'
                    )}`}
                  </span>
                )}
                {validPath && notEnoughDiskSpace && (
                  <span className="warning">
                    {` (${t(
                      'install.not-enough-disk-space',
                      'Not enough disk space'
                    )})`}
                  </span>
                )}
              </span>
            ) : null
          }
        />

        {platformToInstall !== 'linux' && branches.length > 1 && (
          <div>
            <BranchSelector
              appName={gameInfo.app_name}
              branches={branches}
              branch={branch}
              setBranch={setBranch}
              savedBranchPassword={savedBranchPassword}
              onPasswordChange={(newPasswd) =>
                setSavedBranchPassword(newPasswd)
              }
            />
          </div>
        )}

        {platformToInstall !== 'linux' && !!gameBuilds.length && (
          <div>
            <BuildSelector
              gameBuilds={gameBuilds}
              selectedBuild={selectedBuild}
              setSelectedBuild={setSelectedBuild}
            />
          </div>
        )}
        {(haveDLCs || haveSDL) && (
          <div className="InstallModal__sectionHeader">
            {t('sdl.title', 'Select components to Install')}:
          </div>
        )}
        {haveSDL && (
          <div className="InstallModal__sdls">
            {sdls.map((sdl: SelectiveDownload, idx: number) => (
              <label
                key={sdl.name}
                className="InstallModal__toggle toggleWrapper"
              >
                <ToggleSwitch
                  htmlId={`sdls-${idx}`}
                  title={sdl.name}
                  extraClass="InstallModal__toggle--sdl"
                  value={!!sdl.required || !!selectedSdls[getUniqueKey(sdl)]}
                  disabled={sdl.required}
                  handleChange={(e) => handleSdl(sdl, e.target.checked)}
                />
              </label>
            ))}
          </div>
        )}
        {showDlcSelector && (
          <DLCDownloadListing
            DLCList={DLCList}
            dlcsToInstall={dlcsToInstall}
            setDlcsToInstall={setDlcsToInstall}
          />
        )}
        {children}
      </DialogContent>
      <DialogFooter>
        <Tooltip
          title={
            runner === 'itchio'
              ? t(
                  'button.import.itchioUnsupported',
                  'Importing itch.io games is not supported yet'
                )
              : ''
          }
          disableHoverListener={runner !== 'itchio'}
          disableFocusListener={runner !== 'itchio'}
          disableTouchListener={runner !== 'itchio'}
        >
          <span>
            <button
              onClick={handleSwitchToImport}
              disabled={runner === 'itchio'}
              className="button is-secondary"
            >
              {t('button.import', 'Import Game')}
            </button>
          </span>
        </Tooltip>
        <button
          onClick={async () => handleInstall()}
          className="button is-primary"
          disabled={!readyToInstall}
        >
          {!readyToInstall ? (
            <FontAwesomeIcon className="fa-spin-pulse" icon={faSpinner} />
          ) : null}
          {getInstallLabel()}
        </button>
      </DialogFooter>
    </>
  )
}
