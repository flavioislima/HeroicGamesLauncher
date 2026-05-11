import { initImagesCache } from './images_cache'
import { fetchLastestReleases } from './utils/releases'
import { DiskSpaceData, StatusPromise, WineInstallation } from 'common/types'
import * as path from 'path'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  powerSaveBlocker,
  protocol,
  screen,
  clipboard,
  session
} from 'electron'
import {
  addHandler,
  addListener,
  addOneTimeListener,
  sendFrontendMessage
} from 'backend/ipc'
import 'backend/updater'
import 'backend/discounts'
import { autoUpdater } from 'electron-updater'
import { cpus } from 'os'
import { existsSync, watch, readdirSync, readFileSync } from 'graceful-fs'
import 'source-map-support/register'

import Backend from 'i18next-fs-backend'
import i18next from 'i18next'
import { join } from 'path'
import { DXVK, Winetricks } from './tools'
import { GameConfig } from './game_config'
import { GlobalConfig } from './config'
import { LegendaryUser } from 'backend/storeManagers/legendary/user'
import { GOGUser } from './storeManagers/gog/user'
import gogPresence from './storeManagers/gog/presence'
import { NileUser } from './storeManagers/nile/user'
import { ItchioUser } from './storeManagers/itchio/user'
import { ZoomUser } from './storeManagers/zoom/user'
import {
  clearCache,
  isEpicServiceOffline,
  handleExit,
  openUrlOrFile,
  resetHeroic,
  showAboutWindow,
  showItemInFolder,
  getFileSize,
  detectVCRedist,
  getLatestReleases,
  getShellPath,
  getCurrentChangelog,
  removeFolder,
  downloadDefaultWine,
  sendGameStatusUpdate,
  checkRosettaInstall,
  writeConfig,
  createNecessaryFolders,
  clearAchievementCache
} from './utils'
import { startPlausible } from './utils/plausible'

import {
  getDiskInfo,
  isAccessibleWithinFlatpakSandbox,
  isWritable
} from './utils/filesystem'

import { Path } from './schemas'

import { uninstallGameCallback } from './utils/uninstaller'
import { handleProtocol } from './protocol'
import {
  init as initLogger,
  logDebug,
  logError,
  logInfo,
  LogPrefix,
  logWarning
} from './logger'
import { gameInfoStore } from 'backend/storeManagers/legendary/electronStores'
import {
  launchEventCallback,
  readKnownFixes,
  runWineCommand,
  validWine
} from './launcher'
import { initQueue } from './downloadmanager/downloadqueue'
import {
  initOnlineMonitor,
  isOnline,
  runOnceWhenOnline
} from './online_monitor'
import { notify, showDialogBoxModalAuto } from './dialog/dialog'
import { callAbortController } from './utils/aborthandler/aborthandler'
import { getDefaultSavePath } from './save_sync'
import { initTrayIcon } from './tray_icon/tray_icon'
import { createMainWindow, getMainWindow, isFrameless } from './main_window'

import * as GOGLibraryManager from 'backend/storeManagers/gog/library'
import {
  getCyberpunkMods,
  getBranchPassword,
  setBranchPassword,
  getGOGPlaytime,
  syncQueuedPlaytimeGOG
} from 'backend/storeManagers/gog/games'
import { playtimeSyncQueue } from './storeManagers/gog/electronStores'
import * as LegendaryLibraryManager from 'backend/storeManagers/legendary/library'
import {
  autoUpdate,
  gameManagerMap,
  initStoreManagers,
  libraryManagerMap
} from './storeManagers'
import { addNewApp } from './storeManagers/sideload/library'
import {
  getGameOverride,
  getGameSdl
} from 'backend/storeManagers/legendary/library'
import { backendEvents } from './backend_events'
import { configStore } from './constants/key_value_stores'
import {
  customThemesWikiLink,
  discordLink,
  epicLoginUrl,
  githubSponsorsPage,
  heroicGithubURL,
  kofiPage,
  patreonPage,
  sidInfoUrl,
  supportURL,
  weblateUrl,
  wikiLink,
  wineprefixFAQ
} from './constants/urls'
import { legendaryInstalled } from './storeManagers/legendary/constants'
import {
  isCLIConsoleMode,
  isCLIFullscreen,
  isCLINoGui,
  isFlatpak,
  isIntelMac,
  isLinux,
  isMac,
  isSnap,
  isSteamDeckGameMode,
  isWindows
} from './constants/environment'
import {
  configPath,
  gamesConfigPath,
  publicDir,
  userHome,
  webviewPreloadPath,
  windowIcon
} from './constants/paths'
import { supportedLanguages } from 'common/languages'
import MigrationSystem from './migration'
import { getAchievements as getAchievementsGOG } from './storeManagers/gog/games'

if (isLinux) app.commandLine?.appendSwitch('--gtk-version', '3')

const { showOpenDialog } = dialog

async function initializeWindow(): Promise<BrowserWindow> {
  createNecessaryFolders()
  configStore.set('userHome', userHome)
  const mainWindow = createMainWindow()

  if ((isSteamDeckGameMode || isCLIFullscreen) && !isCLINoGui) {
    logInfo(
      [
        isSteamDeckGameMode
          ? 'Heroic started via Steam-Deck gamemode.'
          : 'Heroic started with --fullscreen',
        'Switching to fullscreen'
      ],
      LogPrefix.Backend
    )
    mainWindow.setFullScreen(true)
  }

  setTimeout(async () => {
    // Will download Wine/GPTK if none was found
    const availableWine = await GlobalConfig.get().getAlternativeWine()
    let shouldDownloadWine = !availableWine.length

    if (isMac && !isIntelMac) {
      const toolkitDownloaded = availableWine.some(
        (wine) => wine.type === 'toolkit'
      )

      if (!toolkitDownloaded) {
        shouldDownloadWine = true
      }
    }

    void DXVK.getLatest()

    Winetricks.download()
    if (shouldDownloadWine) {
      downloadDefaultWine()
    }

    if (isMac) {
      checkRosettaInstall()
    }
  }, 2500)

  const globalConf = GlobalConfig.get().getSettings()

  mainWindow.setIcon(windowIcon)
  app.commandLine.appendSwitch('enable-spatial-navigation')

  mainWindow.on('maximize', () => sendFrontendMessage('maximized'))
  mainWindow.on('unmaximize', () => sendFrontendMessage('unmaximized'))
  mainWindow.on('enter-full-screen', () =>
    sendFrontendMessage('fullscreen', true)
  )
  mainWindow.on('leave-full-screen', () =>
    sendFrontendMessage('fullscreen', false)
  )
  mainWindow.on('close', async (e) => {
    e.preventDefault()

    if (!isCLIFullscreen && !isSteamDeckGameMode) {
      // store windows properties
      configStore.set('window-props', {
        ...mainWindow.getBounds(),
        maximized: mainWindow.isMaximized()
      })
    }

    const { exitToTray, noTrayIcon } = GlobalConfig.get().getSettings()

    if (exitToTray && !noTrayIcon) {
      logInfo('Exiting to tray instead of quitting', LogPrefix.Backend)
      return mainWindow.hide()
    }

    handleExit()
  })

  detectVCRedist(mainWindow)

  const startHash =
    isCLIConsoleMode || globalConf.startInConsoleMode ? '/console' : undefined

  if (process.env.ELECTRON_RENDERER_URL) {
    const devUrl = startHash
      ? `${process.env.ELECTRON_RENDERER_URL}#${startHash}`
      : process.env.ELECTRON_RENDERER_URL
    mainWindow.loadURL(devUrl)
    // Open the DevTools.
    mainWindow.webContents.openDevTools()
  } else {
    Menu.setApplicationMenu(null)
    mainWindow.loadFile(
      join(publicDir, 'index.html'),
      startHash ? { hash: startHash } : undefined
    )
    if (globalConf.checkForUpdatesOnStartup) {
      autoUpdater.checkForUpdates()
    }
  }

  // Changelog links workaround
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const pattern = app.isPackaged ? publicDir : 'localhost:5173'
    if (!url.match(pattern)) {
      event.preventDefault()
      openUrlOrFile(url)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const pattern = app.isPackaged ? publicDir : 'localhost:5173'
    return { action: !details.url.match(pattern) ? 'allow' : 'deny' }
  })

  addListener('setZoomFactor', async (event, zoomFactor) => {
    const factor = processZoomForScreen(parseFloat(zoomFactor))
    mainWindow.webContents.setZoomLevel(factor)
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  })

  function applyZoom() {
    const zoomFactor = processZoomForScreen(
      configStore.get('zoomPercent', 100) / 100
    )
    mainWindow.webContents.setZoomLevel(zoomFactor)
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  }

  mainWindow.on('maximize', applyZoom)
  mainWindow.on('unmaximize', applyZoom)
  mainWindow.on('restore', applyZoom)
  mainWindow.on('enter-full-screen', applyZoom)
  mainWindow.on('leave-full-screen', applyZoom)
  mainWindow.webContents.on('did-navigate', applyZoom)

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
const gotTheLock = app.requestSingleInstanceLock()
let openUrlArgument = ''

const processZoomForScreen = (zoomFactor: number) => {
  const screenSize = screen.getPrimaryDisplay().workAreaSize.width
  if (screenSize < 1200) {
    const extraDPIZoomIn = screenSize / 1200
    return (zoomFactor * extraDPIZoomIn - 1) / 0.2
  } else {
    return (zoomFactor - 1) / 0.2
  }
}

if (!gotTheLock) {
  console.log('Heroic is already running, quitting this instance')
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = getMainWindow()
    mainWindow?.show()

    handleProtocol(argv)
  })
  app.whenReady().then(async () => {
    initLogger()

    await MigrationSystem.get().applyMigrations()

    initOnlineMonitor()
    initStoreManagers()
    initImagesCache()

    // Add User-Agent Client hints to behave like Windows
    if (process.argv.includes('--spoof-windows')) {
      session.defaultSession.webRequest.onBeforeSendHeaders(
        (details, callback) => {
          details.requestHeaders['sec-ch-ua-platform'] = 'Windows'
          callback({ cancel: false, requestHeaders: details.requestHeaders })
        }
      )
    }

    // try to fix notification app name on windows
    if (isWindows) {
      app.setAppUserModelId('Heroic Games Launcher')
    }

    runOnceWhenOnline(async () => {
      const isLoggedIn = LegendaryUser.isLoggedIn()

      if (!isLoggedIn) {
        logInfo('User Not Found, removing it from Store', {
          prefix: LogPrefix.Backend,
          forceLog: true
        })
        configStore.delete('userInfo')
      }

      // Update user details
      if (GOGUser.isLoggedIn()) {
        GOGUser.getUserDetails()
      }
    })

    const settings = GlobalConfig.get().getSettings()

    if (settings && settings.analyticsOptIn === true) {
      startPlausible()
    }

    if (settings?.disableSmoothScrolling) {
      app.commandLine.appendSwitch('disable-smooth-scrolling')
    }

    // Make sure lock is not present when starting up
    playtimeSyncQueue.delete('lock')
    if (!settings.disablePlaytimeSync) {
      runOnceWhenOnline(syncQueuedPlaytimeGOG)
    } else {
      logDebug('Skipping playtime sync queue upload - playtime sync disabled', {
        prefix: LogPrefix.Backend
      })
    }
    runOnceWhenOnline(gogPresence.setPresence)
    await i18next.use(Backend).init({
      backend: {
        addPath: path.join(publicDir, 'locales', '{{lng}}', '{{ns}}'),
        allowMultiLoading: false,
        loadPath: path.join(publicDir, 'locales', '{{lng}}', '{{ns}}.json')
      },
      debug: false,
      returnEmptyString: false,
      returnNull: false,
      fallbackLng: 'en',
      lng: settings.language,
      supportedLngs: supportedLanguages
    })

    const mainWindow = await initializeWindow()

    protocol.handle('heroic', (request) => {
      handleProtocol([request.url])
      return new Response('Operation initiated.', { status: 201 })
    })
    if (process.env.CI !== 'e2e' && !app.isDefaultProtocolClient('heroic')) {
      if (app.setAsDefaultProtocolClient('heroic')) {
        logInfo('Registered protocol with OS.', LogPrefix.Backend)
      } else {
        logWarning('Failed to register protocol with OS.', LogPrefix.Backend)
      }
    } else {
      logWarning('Protocol already registered.', LogPrefix.Backend)
    }

    const headless =
      isCLINoGui || (settings.startInTray && !settings.noTrayIcon)
    if (!headless) {
      const isWayland = Boolean(process.env.WAYLAND_DISPLAY)
      const showWindow = () => {
        const props = configStore.get_nodefault('window-props')
        mainWindow.show()
        // Apply maximize only if we show the window
        if (props?.maximized) {
          mainWindow.maximize()
        }
      }
      if (isWayland) {
        // Electron + Wayland don't send ready-to-show
        mainWindow.webContents.once('did-finish-load', showWindow)
      } else {
        mainWindow.once('ready-to-show', showWindow)
      }
    }

    // set initial zoom level after a moment, if set in sync the value stays as 1
    setTimeout(() => {
      const zoomFactor = processZoomForScreen(
        configStore.get('zoomPercent', 100) / 100
      )

      mainWindow.webContents.setZoomLevel(zoomFactor)
      mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
    }, 200)

    addListener('changeLanguage', async (event, language) => {
      logInfo(['Changing Language to:', language], LogPrefix.Backend)
      await i18next.changeLanguage(language)
      gameInfoStore.clear()
      GlobalConfig.get().setSetting('language', language)
      backendEvents.emit('languageChanged')
    })

    fetchLastestReleases()

    initTrayIcon(mainWindow)

    return
  })
}

addListener('notify', (event, args) => notify(args))

addOneTimeListener('frontendReady', () => {
  logInfo('Frontend Ready', LogPrefix.Backend)
  handleProtocol([openUrlArgument, ...process.argv])

  if (isSnap) {
    const snapWarning: Electron.MessageBoxOptions = {
      title: i18next.t('box.warning.snap.title', 'Heroic is running as a Snap'),
      message: i18next.t('box.warning.snap.message', {
        defaultValue:
          'Some features are not available in the Snap version of the app for now and we are trying to fix it.{{newLine}}Current limitations are: {{newLine}}Heroic will not be able to find Proton from Steam or Wine from Lutris.{{newLine}}{{newLine}}Gamescope, GameMode and MangoHud will also not work since Heroic cannot have access to them.{{newLine}}{{newLine}}To have access to this feature please install Heroic as a Flatpak, DEB or from the AppImage.',
        newLine: '\n'
      }),
      checkboxLabel: i18next.t('box.warning.snap.checkbox', {
        defaultValue: 'Do not show this message again'
      }),
      checkboxChecked: false
    }

    const showSnapWarning = configStore.get('showSnapWarning', true)

    if (showSnapWarning) {
      dialog
        .showMessageBox({
          ...snapWarning
        })
        .then((result) => {
          if (result.checkboxChecked) {
            configStore.set('showSnapWarning', false)
          }
        })
    }
  }

  // skip the download queue if we are running in CLI mode
  if (isCLINoGui) {
    return
  }

  setTimeout(() => {
    logInfo('Starting the Download Queue', LogPrefix.Backend)
    initQueue()
  }, 5000)
})

// Maybe this can help with white screens
process.on('uncaughtException', async (err) => {
  logError(err, LogPrefix.Backend)

  // We might get "object has been destroyed" exceptions in CI, since we start
  // and close Heroic quickly there. Displaying an error box would lock up
  // the test (until the timeout is reached), so let's not do that
  if (process.env.CI === 'e2e') return

  showDialogBoxModalAuto({
    title: i18next.t(
      'box.error.uncaught-exception.title',
      'Uncaught Exception occured!'
    ),
    message: i18next.t('box.error.uncaught-exception.message', {
      defaultValue:
        'A uncaught exception occured:{{newLine}}{{error}}{{newLine}}{{newLine}} Report the exception on our Github repository.',
      newLine: '\n',
      error: err
    }),
    type: 'ERROR'
  })
})

let powerId: number | undefined
let displaySleepId: number | undefined

addListener('lock', (e, playing: boolean) => {
  const isSleepBlocked = powerId !== undefined
  const isDisplaySleepBlocked = displaySleepId !== undefined

  if (!playing && !isSleepBlocked) {
    logInfo('Preventing machine to sleep', LogPrefix.Backend)
    powerId = powerSaveBlocker.start('prevent-app-suspension')
  }

  if (playing && !isDisplaySleepBlocked) {
    logInfo('Preventing display to sleep', LogPrefix.Backend)
    displaySleepId = powerSaveBlocker.start('prevent-display-sleep')
  }
})

addListener('unlock', () => {
  if (powerId !== undefined) {
    logInfo('Stopping Power Saver Blocker', LogPrefix.Backend)
    powerSaveBlocker.stop(powerId)
    powerId = undefined
  }
  if (displaySleepId !== undefined) {
    logInfo('Stopping Display Sleep Blocker', LogPrefix.Backend)
    powerSaveBlocker.stop(displaySleepId)
    displaySleepId = undefined
  }
})

addHandler('checkDiskSpace', async (_e, folder): Promise<DiskSpaceData> => {
  // FIXME: Propagate errors

  const parsedPath = Path.parse(folder)

  const { freeSpace, totalSpace } = await getDiskInfo(parsedPath)
  const pathIsWritable = await isWritable(parsedPath)
  const pathIsFlatpakAccessible = isAccessibleWithinFlatpakSandbox(parsedPath)

  return {
    free: freeSpace,
    diskSize: totalSpace,
    validPath: pathIsWritable,
    validFlatpakPath: pathIsFlatpakAccessible,
    message: `${getFileSize(freeSpace)} / ${getFileSize(totalSpace)}`
  }
})

addHandler('isFrameless', () => isFrameless())
addHandler('isMinimized', () => !!getMainWindow()?.isMinimized())
addHandler('isMaximized', () => !!getMainWindow()?.isMaximized())
addListener('minimizeWindow', () => getMainWindow()?.minimize())
addListener('maximizeWindow', () => getMainWindow()?.maximize())
addListener('unmaximizeWindow', () => getMainWindow()?.unmaximize())
addListener('closeWindow', () => getMainWindow()?.close())
addListener('setFullscreen', (_e, enabled) =>
  getMainWindow()?.setFullScreen(enabled)
)
addListener('quit', async () => handleExit())

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  const mainWindow = getMainWindow()

  if (mainWindow) {
    handleProtocol([url])
  } else {
    openUrlArgument = url
  }
})

addListener('openExternalUrl', async (event, url) => openUrlOrFile(url))
addListener('openFolder', async (event, folder) => openUrlOrFile(folder))
addListener('openSupportPage', async () => openUrlOrFile(supportURL))
addListener('openReleases', async () => openUrlOrFile(heroicGithubURL))
addListener('openWeblate', async () => openUrlOrFile(weblateUrl))
addListener('showAboutWindow', () => showAboutWindow())
addListener('openLoginPage', async () => openUrlOrFile(epicLoginUrl))
addListener('openDiscordLink', async () => openUrlOrFile(discordLink))
addListener('openPatreonPage', async () => openUrlOrFile(patreonPage))
addListener('openKofiPage', async () => openUrlOrFile(kofiPage))
addListener('openGithubSponsorsPage', async () =>
  openUrlOrFile(githubSponsorsPage)
)
addListener('openWinePrefixFAQ', async () => openUrlOrFile(wineprefixFAQ))
addListener('openWebviewPage', async (event, url) => openUrlOrFile(url))
addListener('openWikiLink', async () => openUrlOrFile(wikiLink))
addListener('openSidInfoPage', async () => openUrlOrFile(sidInfoUrl))
addListener('openCustomThemesWiki', async () =>
  openUrlOrFile(customThemesWikiLink)
)
addListener('showConfigFileInFolder', async (event, appName) => {
  if (appName === 'default') {
    return openUrlOrFile(configPath)
  }
  return openUrlOrFile(path.join(gamesConfigPath, `${appName}.json`))
})

addListener('removeFolder', async (e, [path, folderName]) => {
  removeFolder(path, folderName)
})

addHandler('runWineCommand', async (e, args) => runWineCommand(args))

/// IPC handlers begin here.

addHandler('checkGameUpdates', async (): Promise<string[]> => {
  let oldGames: string[] = []
  const { autoUpdateGames } = GlobalConfig.get().getSettings()
  for (const runner of Object.keys(
    libraryManagerMap
  ) as (keyof typeof libraryManagerMap)[]) {
    let gamesToUpdate = await libraryManagerMap[runner].listUpdateableGames()
    if (autoUpdateGames) {
      gamesToUpdate = autoUpdate(runner, gamesToUpdate)
    }
    oldGames = [...oldGames, ...gamesToUpdate]
  }

  return oldGames
})

addHandler('getEpicGamesStatus', async () => isEpicServiceOffline())

addHandler('getMaxCpus', () => cpus().length)

addHandler('getHeroicVersion', app.getVersion)
addHandler('isFullscreen', () => isSteamDeckGameMode || isCLIFullscreen)
addHandler('getGameOverride', async () => getGameOverride())
addHandler('getGameSdl', async (event, appName) => getGameSdl(appName))

addHandler('showUpdateSetting', () => !isFlatpak)

addHandler('getLatestReleases', async () => {
  const { checkForUpdatesOnStartup } = GlobalConfig.get().getSettings()
  if (checkForUpdatesOnStartup) {
    return getLatestReleases()
  } else {
    return []
  }
})

addHandler('getCurrentChangelog', async () => {
  return getCurrentChangelog()
})

addListener('clearCache', (event, showDialog, fromVersionChange = false) => {
  clearCache(undefined, fromVersionChange)
  sendFrontendMessage('refreshLibrary')

  if (showDialog) {
    showDialogBoxModalAuto({
      event,
      title: i18next.t('box.cache-cleared.title', 'Cache Cleared'),
      message: i18next.t(
        'box.cache-cleared.message',
        'Heroic Cache Was Cleared!'
      ),
      type: 'MESSAGE',
      buttons: [{ text: i18next.t('box.ok', 'Ok') }]
    })
  }
})

addListener('clearAchievementCache', (event, appName: string) => {
  clearAchievementCache(appName)
  logInfo(
    'Achievement cache was cleared for game: ' + appName,
    LogPrefix.Backend
  )
})

addListener('resetHeroic', () => resetHeroic())

addListener('createNewWindow', (e, url) => {
  new BrowserWindow({ height: 700, width: 1200 }).loadURL(url)
})

addHandler('isGameAvailable', async (e, args) => {
  const { appName, runner } = args
  return gameManagerMap[runner].isGameAvailable(appName)
})

addHandler('getGameInfo', async (event, appName, runner) => {
  // Fastpath since we sometimes have to request info for a GOG game as Legendary because we don't know it's a GOG game yet
  if (runner === 'legendary' && !LegendaryLibraryManager.hasGame(appName)) {
    return null
  }
  const tempGameInfo = gameManagerMap[runner].getGameInfo(appName)
  // The game managers return an empty object if they couldn't fetch the game
  // info, since most of the backend assumes getting it can never fail (and
  // an empty object is a little easier to work with than `null`)
  // The frontend can however handle being passed an explicit `null` value, so
  // we return that here instead if the game info is empty
  if (!Object.keys(tempGameInfo).length) return null
  return tempGameInfo
})

addHandler(
  'getAchievements',
  async (event, appName, runner, lang = 'en-US') => {
    if (runner === 'gog') return getAchievementsGOG(appName, lang)
    return []
  }
)

addHandler('getExtraInfo', async (event, appName, runner) => {
  // Fastpath since we sometimes have to request info for a GOG game as Legendary because we don't know it's a GOG game yet
  if (runner === 'legendary' && !LegendaryLibraryManager.hasGame(appName)) {
    return null
  }
  return gameManagerMap[runner].getExtraInfo(appName)
})

addHandler('getGameSettings', async (event, appName, runner) => {
  try {
    return await gameManagerMap[runner].getSettings(appName)
  } catch (error) {
    logError(error, LogPrefix.Backend)
    return null
  }
})

addHandler('getGOGLinuxInstallersLangs', async (event, appName) =>
  GOGLibraryManager.getLinuxInstallersLanguages(appName)
)

addHandler(
  'getInstallInfo',
  async (event, appName, runner, installPlatform, build, branch) => {
    try {
      const info = await libraryManagerMap[runner].getInstallInfo(
        appName,
        installPlatform,
        {
          branch,
          build
        }
      )
      if (info === undefined) return null
      return info
    } catch (error) {
      logError(
        error,
        runner === 'legendary' ? LogPrefix.Legendary : LogPrefix.Gog
      )
      return null
    }
  }
)

addHandler('getUserInfo', async () => {
  return LegendaryUser.getUserInfo()
})

addHandler('getAmazonUserInfo', async () => NileUser.getUserData())

// Checks if the user have logged in with Legendary already
addHandler('isLoggedIn', LegendaryUser.isLoggedIn)

addHandler('login', async (event, sid) => LegendaryUser.login(sid))
addHandler('authGOG', async (event, code) => GOGUser.login(code))
addHandler('logoutLegendary', LegendaryUser.logout)
addListener('logoutGOG', GOGUser.logout)

addHandler('getAmazonLoginData', NileUser.getLoginData)
addHandler('authAmazon', async (event, data) => NileUser.login(data))
addHandler('logoutAmazon', NileUser.logout)

addHandler('getItchioUserInfo', async () => ItchioUser.getUserData())
addHandler('getItchioLoginData', ItchioUser.getLoginData)
addHandler('authItchio', async (event, data) => ItchioUser.login(data))
addHandler('logoutItchio', ItchioUser.logout)

addHandler('authZoom', async (event, url) => {
  const login = await ZoomUser.login(url)
  if (login.status === 'done') {
    await ZoomUser.getUserDetails()
  }
  return login
})

addListener('logoutZoom', ZoomUser.logout)
addHandler('getZoomUserInfo', async () => ZoomUser.getUserDetails())

addHandler('getAlternativeWine', async () =>
  GlobalConfig.get().getAlternativeWine()
)

addHandler('readConfig', async (event, configClass) => {
  if (configClass === 'library') {
    await libraryManagerMap['legendary'].refresh()
    return LegendaryLibraryManager.getListOfGames()
  }
  const userInfo = LegendaryUser.getUserInfo()
  return userInfo?.displayName ?? ''
})

addHandler('requestAppSettings', () => GlobalConfig.get().getSettings())
addHandler(
  'requestGameSettings',
  async (_e, appName) => await GameConfig.get(appName).getSettings()
)

addHandler('toggleDXVK', async (event, { appName, action }) =>
  GameConfig.get(appName)
    .getSettings()
    .then(async (gameSettings) =>
      DXVK.installRemove(gameSettings, 'dxvk', action)
    )
)

addHandler('toggleDXVKNVAPI', async (event, { appName, action }) =>
  GameConfig.get(appName)
    .getSettings()
    .then(async (gameSettings) =>
      DXVK.installRemove(gameSettings, 'dxvk-nvapi', action)
    )
)

addHandler('toggleVKD3D', async (event, { appName, action }) =>
  GameConfig.get(appName)
    .getSettings()
    .then(async (gameSettings) =>
      DXVK.installRemove(gameSettings, 'vkd3d', action)
    )
)

addHandler('writeConfig', (event, { appName, config }) =>
  writeConfig(appName, config)
)

addListener('setSetting', (event, { appName, key, value }) => {
  if (appName === 'default') {
    GlobalConfig.get().setSetting(key, value)
  } else {
    GameConfig.get(appName).setSetting(key, value)
  }
})

// Watch the installed games file and trigger a refresh on the installed games if something changes
if (existsSync(legendaryInstalled)) {
  let watchTimeout: NodeJS.Timeout | undefined
  watch(legendaryInstalled, () => {
    logInfo('installed.json updated, refreshing library', LogPrefix.Legendary)
    // `watch` might fire twice (while Legendary/we are still writing chunks of the file), which would in turn make LegendaryLibrary fail to
    // decode the JSON data. So instead of immediately calling LegendaryLibrary.get().refreshInstalled(), call it only after no writes happen
    // in a 500ms timespan
    if (watchTimeout) clearTimeout(watchTimeout)
    watchTimeout = setTimeout(LegendaryLibraryManager.refreshInstalled, 500)
  })
}

addHandler('refreshLibrary', async (e, library?) => {
  if (library !== undefined && library !== 'all') {
    await libraryManagerMap[library].refresh()
  } else {
    const allRefreshPromises = []
    for (const manager of Object.values(libraryManagerMap)) {
      allRefreshPromises.push(manager.refresh())
    }
    await Promise.allSettled(allRefreshPromises)
  }
})

// get pid/tid on launch and inject
addHandler('launch', (event, args): StatusPromise => {
  return launchEventCallback(args)
})

addHandler('openDialog', async (e, args) => {
  const mainWindow = getMainWindow()
  if (!mainWindow) {
    return false
  }

  const { filePaths, canceled } = await showOpenDialog(mainWindow, args)
  if (!canceled) {
    return filePaths[0]
  }
  return false
})

addListener('showItemInFolder', async (e, item) => showItemInFolder(item))

addHandler('uninstall', uninstallGameCallback)

addHandler('repair', async (event, appName, runner) => {
  if (!isOnline()) {
    logWarning(
      `App offline, skipping repair for game '${appName}'.`,
      LogPrefix.Backend
    )
    return
  }

  sendGameStatusUpdate({
    appName,
    runner,
    status: 'repairing'
  })

  const { title } = gameManagerMap[runner].getGameInfo(appName)

  try {
    await gameManagerMap[runner].repair(appName)
  } catch (error) {
    notify({
      title,
      body: i18next.t('notify.error.reparing', 'Error Repairing')
    })
    logError(error, LogPrefix.Backend)
  }
  notify({ title, body: i18next.t('notify.finished.reparing') })
  logInfo('Finished repairing', LogPrefix.Backend)

  sendGameStatusUpdate({
    appName,
    runner,
    status: 'done'
  })
})

addHandler(
  'moveInstall',
  async (event, { appName, path, runner }): Promise<void> => {
    sendGameStatusUpdate({
      appName,
      runner,
      status: 'moving'
    })

    const { title } = gameManagerMap[runner].getGameInfo(appName)
    notify({ title, body: i18next.t('notify.moving', 'Moving Game') })

    const moveRes = await gameManagerMap[runner].moveInstall(appName, path)
    if (moveRes.status === 'error') {
      notify({
        title,
        body: i18next.t('notify.error.move', 'Error Moving Game')
      })
      logError(
        `Error while moving ${appName} to ${path}: ${moveRes.error} `,
        LogPrefix.Backend
      )

      showDialogBoxModalAuto({
        event,
        title: i18next.t('box.error.title', 'Error'),
        message: i18next.t('box.error.moving', 'Error Moving Game {{error}}', {
          error: moveRes.error
        }),
        type: 'ERROR'
      })
    }

    if (moveRes.status === 'done') {
      notify({ title, body: i18next.t('notify.moved') })
      logInfo(`Finished moving ${appName} to ${path}.`, LogPrefix.Backend)
    }

    sendGameStatusUpdate({
      appName,
      runner,
      status: 'done'
    })
  }
)

addHandler(
  'importGame',
  async (
    event,
    {
      appName,
      path,
      runner,
      platform,
      winePrefix,
      wineVersion,
      wineCrossoverBottle
    }
  ): StatusPromise => {
    if (runner === 'legendary') {
      const epicOffline = await isEpicServiceOffline()
      if (epicOffline) {
        showDialogBoxModalAuto({
          event,
          title: i18next.t('box.warning.title', 'Warning'),
          message: i18next.t(
            'box.warning.epic.import',
            'Epic Servers are having major outage right now, the game cannot be imported!'
          ),
          type: 'ERROR'
        })
        return { status: 'error' }
      }
    }

    const title = gameManagerMap[runner].getGameInfo(appName).title
    sendGameStatusUpdate({
      appName,
      runner,
      status: 'importing'
    })

    const abortMessage = () => {
      notify({
        title,
        body: i18next.t('notify.import.failed', 'Importing Failed')
      })
      sendGameStatusUpdate({
        appName,
        runner,
        status: 'done'
      })
    }

    try {
      const { abort, error } = await gameManagerMap[runner].importGame(
        appName,
        path,
        platform
      )
      if (abort || error) {
        abortMessage()
        return { status: 'done' }
      }
    } catch (error) {
      abortMessage()
      logError(error, LogPrefix.Backend)
      return { status: 'error' }
    }

    if (winePrefix && wineVersion) {
      const gameSettings = await gameManagerMap[runner].getSettings(appName)
      writeConfig(appName, {
        ...gameSettings,
        winePrefix,
        wineVersion,
        wineCrossoverBottle
      })
    }

    notify({
      title,
      body: i18next.t('notify.install.imported', 'Game Imported')
    })
    sendGameStatusUpdate({
      appName,
      runner,
      status: 'done'
    })
    logInfo(`imported ${title}`, LogPrefix.Backend)
    return { status: 'done' }
  }
)

addHandler('kill', async (event, appName, runner) => {
  callAbortController(appName)
  return gameManagerMap[runner].stop(appName)
})

addHandler('changeInstallPath', async (event, { appName, path, runner }) => {
  await libraryManagerMap[runner].changeGameInstallPath(appName, path)
  logInfo(
    `Finished changing install path of ${appName} to ${path}.`,
    LogPrefix.Backend
  )
})

addHandler('egsSync', async (event, args) => {
  return LegendaryLibraryManager.toggleGamesSync(args)
})

addHandler('syncGOGSaves', async (event, gogSaves, appName, arg) =>
  gameManagerMap['gog'].syncSaves(appName, arg, '', gogSaves)
)

addHandler('getLaunchOptions', async (event, appName, runner) => {
  const availableLaunchOptions =
    await libraryManagerMap[runner].getLaunchOptions(appName)

  // add a default option if there are other options but no default
  if (
    availableLaunchOptions.length > 0 &&
    !availableLaunchOptions.some(
      (option) =>
        (option.type === undefined || option.type === 'basic') &&
        option.name === 'Default' &&
        option.parameters === ''
    )
  ) {
    availableLaunchOptions.unshift({
      name: i18next.t('launch.default', 'Default', {
        ns: 'gamepage'
      }),
      parameters: '',
      type: 'basic'
    })
  }

  return availableLaunchOptions
})

addHandler('syncSaves', async (event, { arg = '', path, appName, runner }) => {
  if (runner === 'legendary') {
    const epicOffline = await isEpicServiceOffline()
    if (epicOffline) {
      logWarning(
        'Epic is offline right now, cannot sync saves!',
        LogPrefix.Backend
      )
      return 'Epic is offline right now, cannot sync saves!'
    }
  }
  if (!isOnline()) {
    logWarning('App is offline, cannot sync saves!', LogPrefix.Backend)
    return 'App is offline, cannot sync saves!'
  }

  const output = await gameManagerMap[runner].syncSaves(appName, arg, path)
  logInfo(output, LogPrefix.Backend)
  return output
})

addHandler(
  'getDefaultSavePath',
  async (event, appName, runner, alreadyDefinedGogSaves) =>
    getDefaultSavePath(appName, runner, alreadyDefinedGogSaves)
)

// Simulate keyboard and mouse actions as if the real input device is used
addHandler('gamepadAction', async (event, args) => {
  // we can only receive gamepad events if the main window exists
  const mainWindow = getMainWindow()!

  const { action, metadata } = args
  const inputEvents: (
    | Electron.MouseInputEvent
    | Electron.MouseWheelInputEvent
    | Electron.KeyboardInputEvent
  )[] = []

  /*
   * How to extend:
   *
   * Valid values for type are 'keyDown', 'keyUp' and 'char'
   * Valid values for keyCode are defined here:
   * https://www.electronjs.org/docs/latest/api/accelerator#available-key-codes
   *
   */
  switch (action) {
    case 'rightStickUp':
      inputEvents.push({
        type: 'mouseWheel',
        deltaY: 50,
        x: mainWindow.getBounds().width / 2,
        y: mainWindow.getBounds().height / 2
      })
      break
    case 'rightStickDown':
      inputEvents.push({
        type: 'mouseWheel',
        deltaY: -50,
        x: mainWindow.getBounds().width / 2,
        y: mainWindow.getBounds().height / 2
      })
      break
    case 'leftStickUp':
    case 'leftStickDown':
    case 'leftStickLeft':
    case 'leftStickRight':
    case 'padUp':
    case 'padDown':
    case 'padLeft':
    case 'padRight':
      // spatial navigation
      inputEvents.push({
        type: 'keyDown',
        keyCode: action.replace(/pad|leftStick/, '')
      })
      inputEvents.push({
        type: 'keyUp',
        keyCode: action.replace(/pad|leftStick/, '')
      })
      break
    case 'leftClick':
      inputEvents.push({
        type: 'mouseDown',
        button: 'left',
        x: metadata.x,
        y: metadata.y
      })
      inputEvents.push({
        type: 'mouseUp',
        button: 'left',
        x: metadata.x,
        y: metadata.y
      })
      break
    case 'rightClick':
      inputEvents.push({
        type: 'mouseDown',
        button: 'right',
        x: metadata.x,
        y: metadata.y
      })
      inputEvents.push({
        type: 'mouseUp',
        button: 'right',
        x: metadata.x,
        y: metadata.y
      })
      break
    case 'back':
      mainWindow.webContents.goBack()
      break
    case 'esc':
      inputEvents.push({
        type: 'keyDown',
        keyCode: 'Esc'
      })
      inputEvents.push({
        type: 'keyUp',
        keyCode: 'Esc'
      })
      break
    case 'tab':
      inputEvents.push(
        {
          type: 'keyDown',
          keyCode: 'Tab'
        },
        {
          type: 'keyUp',
          keyCode: 'Tab'
        }
      )
      break
    case 'shiftTab':
      inputEvents.push(
        {
          type: 'keyDown',
          keyCode: 'Tab',
          modifiers: ['shift']
        },
        {
          type: 'keyUp',
          keyCode: 'Tab',
          modifiers: ['shift']
        }
      )
      break
  }

  if (inputEvents.length) {
    inputEvents.forEach((event) => mainWindow.webContents.sendInputEvent(event))
  }
})

addHandler('getShellPath', async (event, path) => getShellPath(path))

addHandler('getWebviewPreloadPath', () => webviewPreloadPath)

addHandler('clipboardReadText', () => clipboard.readText())

addListener('clipboardWriteText', (e, text) => clipboard.writeText(text))

addHandler('getCustomThemes', async () => {
  const { customThemesPath } = GlobalConfig.get().getSettings()

  if (!existsSync(customThemesPath)) {
    return []
  }

  return readdirSync(customThemesPath).filter((fileName) =>
    fileName.endsWith('.css')
  )
})

addHandler('getThemeCSS', async (event, theme) => {
  const { customThemesPath = '' } = GlobalConfig.get().getSettings()

  const cssPath = path.join(customThemesPath, theme)

  if (!existsSync(cssPath)) {
    return ''
  }

  return readFileSync(cssPath, 'utf-8')
})

addHandler('getCustomCSS', async () => {
  return GlobalConfig.get().getSettings().customCSS
})

addListener('setTitleBarOverlay', (e, args) => {
  const mainWindow = getMainWindow()
  if (typeof mainWindow?.['setTitleBarOverlay'] === 'function') {
    logDebug(`Setting titlebar overlay options ${JSON.stringify(args)}`)
    mainWindow?.setTitleBarOverlay(args)
  }
})

addListener('addNewApp', (e, args) => addNewApp(args))

addHandler('isNative', (e, { appName, runner }) => {
  return gameManagerMap[runner].isNative(appName)
})

addHandler('pathExists', async (e, path: string) => {
  return existsSync(path)
})

addListener('processShortcut', async (e, combination: string) => {
  const mainWindow = getMainWindow()

  switch (combination) {
    // hotkey to reload the app
    case 'ctrl+r':
      mainWindow?.reload()
      break
    // hotkey to quit the app
    case 'ctrl+q':
      handleExit()
      break
    // hotkey to open the settings on frontend
    case 'ctrl+k':
      sendFrontendMessage('openScreen', '/settings/general')
      break
    // hotkey to open the downloads screen on frontend
    case 'ctrl+j':
      sendFrontendMessage('openScreen', '/download-manager')
      break
    // hotkey to open the library screen on frontend
    case 'ctrl+l':
      sendFrontendMessage('openScreen', '/library')
      break
    case 'ctrl+shift+i':
      mainWindow?.webContents?.openDevTools()
      break
  }
})

addHandler(
  'getPlaytimeFromRunner',
  async (e, runner, appName): Promise<number | undefined> => {
    const { disablePlaytimeSync } = GlobalConfig.get().getSettings()
    if (disablePlaytimeSync) {
      return
    }
    if (runner === 'gog') {
      return getGOGPlaytime(appName)
    }

    return
  }
)

addHandler('getPrivateBranchPassword', (e, appName) =>
  getBranchPassword(appName)
)
addHandler('setPrivateBranchPassword', (e, appName, password) =>
  setBranchPassword(appName, password)
)

addHandler('getAvailableCyberpunkMods', async () => getCyberpunkMods())
addHandler('setCyberpunkModConfig', async (e, props) =>
  GOGLibraryManager.setCyberpunkModConfig(props)
)

addListener('changeGameVersionPinnedStatus', (e, appName, runner, status) => {
  libraryManagerMap[runner].changeVersionPinnedStatus(appName, status)
})

addHandler('getKnownFixes', (e, appName, runner) =>
  readKnownFixes(appName, runner)
)

addHandler('wine.isValidVersion', async (e, wineVersion: WineInstallation) =>
  validWine(wineVersion)
)

/*
  Other Keys that should go into translation files:
  t('box.error.generic.title')
  t('box.error.generic.message')
 */

/*
 * INSERT OTHER IPC HANDLERS HERE
 */
import './logger/ipc_handler'
import './wine/manager/ipc_handler'
import './shortcuts/ipc_handler'
import './anticheat/ipc_handler'
import './storeManagers/legendary/eos_overlay/ipc_handler'
import './wine/runtimes/ipc_handler'
import './downloadmanager/ipc_handler'
import './utils/ipc_handler'
import './wiki_game_info/ipc_handler'
import './recent_games/ipc_handler'
import './tools/ipc_handler'
import './progress_bar'
import './steamgrid/ipc_handler'
