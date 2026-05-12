import { copyFileSync, existsSync } from 'graceful-fs'
import axios from 'axios'

import {
  ExecResult,
  ExtraInfo,
  GameInfo,
  InstallArgs,
  InstallPlatform,
  InstallProgress,
  WineCommandArgs,
  LaunchOption
} from 'common/types'
import { GameConfig } from '../../game_config'
import { GlobalConfig } from '../../config'
import {
  runRunnerCommand as runLegendaryCommand,
  getInstallInfo,
  listUpdateableGames,
  getGameInfo as getLegLibraryGameInfo,
  changeGameInstallPath,
  installState
} from './library'
import { LegendaryUser } from './user'
import {
  downloadFile,
  killPattern,
  moveOnUnix,
  moveOnWindows,
  sendGameStatusUpdate,
  sendProgressUpdate,
  shutdownWine,
  spawnAsync
} from '../../utils'
import {
  logError,
  logInfo,
  LogPrefix,
  createGameLogWriter
} from 'backend/logger'
import {
  prepareLaunch,
  prepareWineLaunch,
  setupEnvVars,
  setupWrapperEnvVars,
  setupWrappers,
  launchCleanup,
  runWineCommand as runWineCommandUtil,
  getKnownFixesEnvVariables,
  getWinePath
} from '../../launcher'
import {
  addShortcuts as addShortcutsUtil,
  removeShortcuts as removeShortcutsUtil
} from '../../shortcuts/shortcuts/shortcuts'
import { join } from 'path'
import { gameInfoStore } from './electronStores'
import { removeNonSteamGame } from '../../shortcuts/nonesteamgame/nonesteamgame'
import shlex from 'shlex'
import { t } from 'i18next'
import { isOnline } from '../../online_monitor'
import { showDialogBoxModalAuto } from '../../dialog/dialog'
import { Catalog, Product } from 'common/types/epic-graphql'
import { sendFrontendMessage } from '../../ipc'
import { RemoveArgs } from 'common/types/game_manager'
import {
  AllowedWineFlags,
  getWineFlags,
  isUmuSupported
} from 'backend/utils/compatibility_layers'
import {
  LegendaryAppName,
  LegendaryPlatform,
  NonEmptyString,
  PositiveInteger
} from './commands/base'
import { LegendaryCommand } from './commands'
import { getUmuId } from 'backend/wiki_game_info/umu/utils'
import thirdParty from './thirdParty'
import { Path } from 'backend/schemas'
import { mkdirSync } from 'fs'
import { configStore } from 'backend/constants/key_value_stores'
import { epicRedistPath, legendaryInstalled } from './constants'
import { isCLINoGui, isMac, isWindows } from 'backend/constants/environment'
import { fakeEpicExePath } from 'backend/constants/paths'

import type LogWriter from 'backend/logger/log_writer'

/**
 * Alias for `LegendaryLibrary.listUpdateableGames`
 */
export async function checkGameUpdates() {
  const isLoggedIn = LegendaryUser.isLoggedIn()
  if (!isLoggedIn) {
    return []
  }
  return listUpdateableGames()
}

/**
 * Alias for `LegendaryLibrary.getGameInfo(appName)`
 *
 * @returns GameInfo
 */
export function getGameInfo(appName: string): GameInfo {
  const info = getLegLibraryGameInfo(appName)
  if (!info) {
    logError(
      [
        'Could not get game info for',
        `${appName},`,
        'returning empty object. Something is probably gonna go wrong soon'
      ],
      LogPrefix.Legendary
    )
    return {
      app_name: '',
      runner: 'legendary',
      art_cover: '',
      art_square: '',
      install: {},
      is_installed: false,
      title: '',
      canRunOffline: false
    }
  }
  return info
}

async function getProductSlug(namespace: string, title: string) {
  // If you want to change this graphql query, make sure it works for these games:
  // Rocket League
  // Alba - A Wildlife Adventure
  const graphql = {
    query: `{
          Catalog {
            catalogNs(namespace: "${namespace}") {
              mappings (pageType: "productHome") {
                pageSlug
                pageType
              }
            }
          }
      }`
  }

  try {
    const result = await axios('https://launcher.store.epicgames.com/graphql', {
      data: graphql,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) EpicGamesLauncher'
      },
      method: 'POST'
    })

    const res = result.data.data.Catalog as Catalog
    const slugMapping = res.catalogNs.mappings.find(
      (mapping) => mapping.pageType === 'productHome'
    )

    if (slugMapping) {
      return slugMapping.pageSlug
    } else {
      return slugFromTitle(title)
    }
  } catch (error) {
    logError(error, LogPrefix.Legendary)
    return slugFromTitle(title)
  }
}

async function getExtraFromAPI(slug: string): Promise<ExtraInfo | null> {
  let lang = configStore.get('language', '')
  if (lang === 'pt') {
    lang = 'pt-BR'
  }
  if (lang === 'zh_Hans') {
    lang = 'zh-CN'
  }

  const epicUrl = `https://store-content.ak.epicgames.com/api/${lang}/content/products/${slug}`

  try {
    const { data } = await axios({ method: 'GET', url: epicUrl })
    logInfo('Getting Info from Epic API', LogPrefix.Legendary)

    const about = data?.pages?.find(
      (e: { type: string }) => e.type === 'productHome'
    )

    if (about) {
      return {
        about: about.data.about,
        reqs: about.data.requirements.systems[0].details,
        releaseDate: about.data.meta.releaseDate?.substring(0, 19),
        storeUrl: `https://www.epicgames.com/store/product/${slug}`
      }
    } else {
      return null
    }
  } catch (error) {
    logError(['Failed to get info from Epic API:', error], LogPrefix.Legendary)
    return null
  }
}

async function getExtraFromGraphql(
  namespace: string,
  slug: string
): Promise<ExtraInfo | null> {
  const graphql = {
    query: `{
        Product {
          sandbox(sandboxId: "${namespace}") {
            configuration {
              ... on StoreConfiguration {
                configs {
                  shortDescription
                  technicalRequirements {
                    macos {
                      minimum
                      recommended
                      title
                    }
                    windows {
                      minimum
                      recommended
                      title
                    }
                  }
                }
              }
            }
          }
        }
      }`
  }

  try {
    const result = await axios('https://launcher.store.epicgames.com/graphql', {
      data: graphql,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) EpicGamesLauncher'
      },
      method: 'POST'
    })

    const res = result.data.data.Product as Product

    const configuration = res.sandbox.configuration[0]

    if (!configuration) {
      return null
    }

    const requirements = configuration.configs.technicalRequirements.windows

    if (requirements) {
      return {
        about: {
          description: res.sandbox.configuration[0].configs.shortDescription,
          shortDescription: ''
        },
        reqs: requirements,
        storeUrl: `https://www.epicgames.com/store/product/${slug}`
      }
    } else {
      return null
    }
  } catch (error) {
    logError(error, LogPrefix.Legendary)
    return null
  }
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replaceAll(' ', '-')
}

const emptyExtraInfo = {
  about: {
    description: '',
    shortDescription: ''
  },
  reqs: [],
  storeUrl: ''
}
/**
 * Get extra info from Epic's API.
 *
 */
export async function getExtraInfo(appName: string): Promise<ExtraInfo> {
  const { namespace, title } = getGameInfo(appName)
  if (namespace === undefined) return emptyExtraInfo

  const cachedExtraInfo = gameInfoStore.get(namespace)
  if (cachedExtraInfo) {
    return cachedExtraInfo
  }
  if (!isOnline()) {
    return emptyExtraInfo
  }

  const slug = await getProductSlug(namespace, title)

  // try the API first, it works for most games
  let extraData = await getExtraFromAPI(slug)

  // if the API doesn't work, try graphql
  if (!extraData) {
    extraData = await getExtraFromGraphql(namespace, slug)
  }

  // if we have data, store it and return
  if (extraData) {
    gameInfoStore.set(namespace, extraData)
    return extraData
  } else {
    logError('Error Getting Info from Epic API', LogPrefix.Legendary)
    return {
      about: {
        description: '',
        shortDescription: ''
      },
      reqs: [],
      storeUrl: ''
    }
  }
}

/**
 * Alias for `GameConfig.get(appName).config`
 * If it doesn't exist, uses getSettings() instead.
 *
 * @returns GameConfig
 */
export async function getSettings(appName: string) {
  return (
    GameConfig.get(appName).config ||
    (await GameConfig.get(appName).getSettings())
  )
}

/**
 * Parent folder to move app to.
 * Amends install path by adding the appropriate folder name.
 */
export async function moveInstall(
  appName: string,
  newInstallPath: string
): Promise<{ status: 'done' } | { status: 'error'; error: string }> {
  const gameInfo = getGameInfo(appName)
  logInfo(`Moving ${gameInfo.title} to ${newInstallPath}`, LogPrefix.Gog)

  const moveImpl = isWindows ? moveOnWindows : moveOnUnix
  const moveResult = await moveImpl(newInstallPath, gameInfo)

  if (moveResult.status === 'error') {
    const { error } = moveResult
    logError(
      ['Error moving', gameInfo.title, 'to', newInstallPath, error],
      LogPrefix.Legendary
    )

    return { status: 'error', error }
  }

  await changeGameInstallPath(appName, moveResult.installPath)
  return { status: 'done' }
}

// used when downloading games, store the download size read from Legendary's output
interface currentDownloadSizeMap {
  [key: string]: number
}
const currentDownloadSize: currentDownloadSizeMap = {}

export function getCurrentDownloadSize(appName: string) {
  return currentDownloadSize[appName]
}

export function setCurrentDownloadSize(appName: string, size: number) {
  return (currentDownloadSize[appName] = size)
}

interface tmpProgressMap {
  [key: string]: InstallProgress
}

function defaultTmpProgres() {
  return {
    bytes: '',
    eta: '',
    percent: undefined,
    diskSpeed: undefined,
    downSpeed: undefined
  }
}
const tmpProgress: tmpProgressMap = {}

export function onInstallOrUpdateOutput(
  appName: string,
  action: 'installing' | 'updating',
  data: string,
  totalDownloadSize: number
) {
  const downloadSizeMatch = data.match(/Download size: ([\d.]+) MiB/)

  // store the download size, needed for correct calculation
  // when cancel/resume downloads
  if (downloadSizeMatch) {
    currentDownloadSize[appName] = parseFloat(downloadSizeMatch[1])
  }

  if (!Object.hasOwn(tmpProgress, appName)) {
    tmpProgress[appName] = defaultTmpProgres()
  }

  const progress = tmpProgress[appName]

  // parse log for eta
  if (progress.eta === '') {
    const etaMatch = data.match(/ETA: (\d\d:\d\d:\d\d)/m)
    progress.eta = etaMatch && etaMatch?.length >= 2 ? etaMatch[1] : ''
  }

  // parse log for game download progress
  if (progress.bytes === '') {
    const bytesMatch = data.match(/Downloaded: (\S+.) MiB/m)
    progress.bytes =
      bytesMatch && bytesMatch?.length >= 2 ? `${bytesMatch[1]}MB` : ''
  }

  // parse log for download speed
  if (!progress.downSpeed) {
    const downSpeedMBytes = data.match(/Download\t- (\S+.) MiB/m)
    progress.downSpeed = !Number.isNaN(Number(downSpeedMBytes?.at(1)))
      ? Number(downSpeedMBytes?.at(1))
      : undefined
  }

  // parse disk write speed
  if (!progress.diskSpeed) {
    const diskSpeedMBytes = data.match(/Disk\t- (\S+.) MiB/m)
    progress.diskSpeed = !Number.isNaN(Number(diskSpeedMBytes?.at(1)))
      ? Number(diskSpeedMBytes?.at(1))
      : undefined
  }

  // original is in bytes, convert to MiB with 2 decimals
  totalDownloadSize = Math.round((totalDownloadSize / 1024 / 1024) * 100) / 100

  // calculate percentage
  if (progress.bytes !== '') {
    const downloaded = parseFloat(progress.bytes)
    const downloadCache = totalDownloadSize - currentDownloadSize[appName]
    const totalDownloaded = downloaded + downloadCache
    const newPercent =
      Math.round((totalDownloaded / totalDownloadSize) * 10000) / 100
    progress.percent = newPercent >= 0 ? newPercent : undefined
  }

  // only send to frontend if all values are updated
  if (
    Object.values(progress).every(
      (value) => !(value === undefined || value === '')
    )
  ) {
    logInfo(
      [
        `Progress for ${getGameInfo(appName).title}:`,
        `${progress.percent}%/${progress.bytes}/${progress.eta}`.trim(),
        `Down: ${progress.downSpeed}MB/s / Disk: ${progress.diskSpeed}MB/s`
      ],
      LogPrefix.Legendary
    )

    sendProgressUpdate({
      appName: appName,
      runner: 'legendary',
      status: action,
      progress: progress
    })

    // reset
    tmpProgress[appName] = defaultTmpProgres()
  }
}

/**
 * Update game.
 * Does NOT check for online connectivity.
 */
export async function update(
  appName: string
): Promise<{ status: 'done' | 'error' }> {
  sendGameStatusUpdate({
    appName: appName,
    runner: 'legendary',
    status: 'updating'
  })
  const { maxWorkers, downloadNoHttps } = GlobalConfig.get().getSettings()
  const installPlatform = getGameInfo(appName).install.platform!
  const info = await getInstallInfo(appName, installPlatform)

  const command: LegendaryCommand = {
    subcommand: 'update',
    appName: LegendaryAppName.parse(appName),
    '-y': true,
    '--skip-sdl': true
  }
  if (maxWorkers) command['--max-workers'] = PositiveInteger.parse(maxWorkers)
  if (downloadNoHttps) command['--no-https'] = true

  const onOutput = (data: string) => {
    onInstallOrUpdateOutput(
      appName,
      'updating',
      data,
      info.manifest?.download_size
    )
  }

  const updateLogWriter = await createGameLogWriter(
    appName,
    'legendary',
    'update'
  )
  const res = await runLegendaryCommand(command, {
    abortId: appName,
    logWriters: [updateLogWriter],
    onOutput,
    logMessagePrefix: `Updating ${appName}`
  })

  sendGameStatusUpdate({
    appName: appName,
    runner: 'legendary',
    status: 'done'
  })

  if (res.error) {
    logError(
      ['Failed to update', `${appName}:`, res.error],
      LogPrefix.Legendary
    )
    return { status: 'error' }
  }
  return { status: 'done' }
}

/**
 * Adds a desktop shortcut to $HOME/Desktop and to /usr/share/applications
 * so that the game can be opened from the start menu and the desktop folder.
 * Both can be disabled with addDesktopShortcuts and addStartMenuShortcuts
 * @async
 * @public
 */
export async function addShortcuts(appName: string, fromMenu?: boolean) {
  return addShortcutsUtil(getGameInfo(appName), fromMenu)
}

/**
 * Removes a desktop shortcut from $HOME/Desktop and to $HOME/.local/share/applications
 * @async
 * @public
 */
export async function removeShortcuts(appName: string) {
  return removeShortcutsUtil(getGameInfo(appName))
}

/**
 * Install game.
 * Does NOT check for online connectivity.
 */
export async function install(
  appName: string,
  { path, sdlList, platformToInstall }: InstallArgs
): Promise<{
  status: 'done' | 'error' | 'abort'
  error?: string
}> {
  const gameInfo = getGameInfo(appName)
  if (gameInfo.thirdPartyManagedApp) {
    if (gameInfo.isEAManaged) {
      return installEA(gameInfo, platformToInstall)
    } else if (gameInfo.isUbisoftManaged) {
      return installUbisoft(gameInfo, platformToInstall)
    }

    logError(
      ['Third party app', gameInfo.thirdPartyManagedApp, 'not supported'],
      LogPrefix.Legendary
    )
    return { status: 'error' }
  }
  const { maxWorkers, downloadNoHttps } = GlobalConfig.get().getSettings()
  const info = await getInstallInfo(appName, platformToInstall)

  const command: LegendaryCommand = {
    subcommand: 'install',
    appName: LegendaryAppName.parse(appName),
    '--platform': LegendaryPlatform.parse(platformToInstall),
    '--base-path': Path.parse(path),
    '--skip-dlcs': true,
    '-y': true
  }
  if (maxWorkers) command['--max-workers'] = PositiveInteger.parse(maxWorkers)
  if (downloadNoHttps) command['--no-https'] = true
  if (sdlList?.length)
    command.sdlList = sdlList.map((tag) => NonEmptyString.parse(tag))
  else command['--skip-sdl'] = true

  const onOutput = (data: string) => {
    onInstallOrUpdateOutput(
      appName,
      'installing',
      data,
      info.manifest?.download_size
    )
  }

  const installLogWriter = await createGameLogWriter(
    appName,
    'legendary',
    'install'
  )
  let res = await runLegendaryCommand(command, {
    abortId: appName,
    logWriters: [installLogWriter],
    onOutput,
    logMessagePrefix: `Installing ${appName}`
  })

  // try to run the install again with higher memory limit
  if (res.stderr.includes('MemoryError:')) {
    command['--max-shared-memory'] = PositiveInteger.parse(5000)
    res = await runLegendaryCommand(command, {
      abortId: appName,
      logWriters: [installLogWriter],
      onOutput
    })
  }

  if (res.abort) {
    return { status: 'abort' }
  }

  if (res.error) {
    if (!res.error.includes('signal')) {
      logError(
        ['Failed to install', `${appName}:`, res.error],
        LogPrefix.Legendary
      )
    }
    return { status: 'error', error: res.error }
  }
  addShortcuts(appName)

  return { status: 'done' }
}

async function installEA(
  gameInfo: GameInfo,
  platformToInstall: string
): Promise<{
  status: 'done' | 'error' | 'abort'
  error?: string
}> {
  logInfo('Getting EA App installer', LogPrefix.Legendary)
  const installerPath = join(epicRedistPath, 'EAappInstaller.exe')

  if (!existsSync(epicRedistPath)) {
    mkdirSync(epicRedistPath, { recursive: true })
  }

  if (!existsSync(installerPath)) {
    try {
      await downloadFile({
        url: 'https://origin-a.akamaihd.net/EA-Desktop-Client-Download/installer-releases/EAappInstaller.exe',
        dest: installerPath
      })
    } catch (e) {
      return { status: 'error', error: `${e}` }
    }
  }

  if (isWindows) {
    const process = await spawnAsync(installerPath, [
      'EAX_LAUNCH_CLIENT=0',
      'IGNORE_INSTALLED=1'
    ])

    if (process.code !== null && process.code === 3) {
      return { status: 'abort' }
    }
  }

  await thirdParty.addInstalledGame(gameInfo.app_name, platformToInstall)

  return { status: 'done' }
}

async function installUbisoft(
  gameInfo: GameInfo,
  platformToInstall: string
): Promise<{
  status: 'done' | 'error' | 'abort'
  error?: string
}> {
  logInfo('Getting Ubisoft installer', LogPrefix.Legendary)
  const installerPath = join(epicRedistPath, 'UbisoftConnectInstaller.exe')

  if (!existsSync(epicRedistPath)) {
    mkdirSync(epicRedistPath, { recursive: true })
  }

  if (!existsSync(installerPath)) {
    try {
      await downloadFile({
        url: 'https://static3.cdn.ubi.com/orbit/launcher_installer/UbisoftConnectInstaller.exe',
        dest: installerPath
      })
    } catch (e) {
      return { status: 'error', error: `${e}` }
    }
  }

  if (isWindows) {
    const process = await spawnAsync(installerPath, ['/S'])

    if (process.code !== null && process.code === 3) {
      return { status: 'abort' }
    }
  }

  await thirdParty.addInstalledGame(gameInfo.app_name, platformToInstall)

  return { status: 'done' }
}

export async function uninstall({ appName }: RemoveArgs): Promise<ExecResult> {
  const gameInfo = getGameInfo(appName)
  if (gameInfo.thirdPartyManagedApp) {
    await thirdParty.removeInstalledGame(appName)
    return { stdout: '', stderr: '' }
  }

  const command: LegendaryCommand = {
    subcommand: 'uninstall',
    appName: LegendaryAppName.parse(appName),
    '-y': true
  }

  const res = await runLegendaryCommand(command, {
    abortId: appName,
    logMessagePrefix: `Uninstalling ${appName}`
  })

  if (res.error) {
    logError(
      ['Failed to uninstall', `${appName}:`, res.error],
      LogPrefix.Legendary
    )
  } else if (!res.abort) {
    installState(appName, false)
    await removeShortcutsUtil(getGameInfo(appName))
    const gameInfo = getGameInfo(appName)
    await removeNonSteamGame({ gameInfo })
  }
  sendFrontendMessage('refreshLibrary', 'legendary')
  return res
}

/**
 * Repair game.
 * Does NOT check for online connectivity.
 */
export async function repair(appName: string): Promise<ExecResult> {
  const { maxWorkers, downloadNoHttps } = GlobalConfig.get().getSettings()

  const command: LegendaryCommand = {
    subcommand: 'repair',
    appName: LegendaryAppName.parse(appName),
    '-y': true,
    '--skip-sdl': true
  }
  if (maxWorkers) command['--max-workers'] = PositiveInteger.parse(maxWorkers)
  if (downloadNoHttps) command['--no-https'] = true

  const repairLogWriter = await createGameLogWriter(
    appName,
    'legendary',
    'repair'
  )
  const res = await runLegendaryCommand(command, {
    abortId: appName,
    logWriters: [repairLogWriter],
    logMessagePrefix: `Repairing ${appName}`
  })

  if (res.error) {
    logError(
      ['Failed to repair', `${appName}:`, res.error],
      LogPrefix.Legendary
    )
  }
  return res
}

export async function importGame(
  appName: string,
  folderPath: string,
  platform: InstallPlatform
): Promise<ExecResult> {
  const command: LegendaryCommand = {
    subcommand: 'import',
    appName: LegendaryAppName.parse(appName),
    installationDirectory: Path.parse(folderPath),
    '--with-dlcs': true,
    '--platform': LegendaryPlatform.parse(platform)
  }

  logInfo(`Importing ${appName}.`, LogPrefix.Legendary)

  const logWriter = await createGameLogWriter(appName, 'legendary', 'import')
  const res = await runLegendaryCommand(command, {
    abortId: appName,
    logWriters: [logWriter]
  })
  addShortcuts(appName)
  const errorMatch = res.stderr.match(/^.*ERROR:.*$/gm)?.join('') ?? ''
  res.error = (res.error ?? '') + errorMatch
  if (res.error) {
    logError(
      ['Failed to import', `${appName}:`, res.error],
      LogPrefix.Legendary
    )
  }
  return res
}

/**
 * Sync saves.
 * Does NOT check for online connectivity.
 */
export async function syncSaves(
  appName: string,
  arg: string,
  path: string
): Promise<string> {
  if (!path) {
    logError(
      'No path provided for SavesSync, check your settings!',
      LogPrefix.Legendary
    )
    return 'No path provided.'
  }

  const command: LegendaryCommand = {
    subcommand: 'sync-saves',
    appName: LegendaryAppName.parse(appName),
    [arg]: true,
    '--save-path': Path.parse(path),
    '-y': true
  }

  let fullOutput = ''
  const res = await runLegendaryCommand(command, {
    abortId: appName,
    logMessagePrefix: `Syncing saves for ${getGameInfo(appName).title}`,
    onOutput: (output) => (fullOutput += output)
  })

  if (res.error) {
    logError(
      ['Failed to sync saves for', `${appName}:`, res.error],
      LogPrefix.Legendary
    )
  }
  return fullOutput
}

export async function launch(
  appName: string,
  logWriter: LogWriter,
  launchArguments?: LaunchOption,
  args: string[] = [],
  skipVersionCheck = false
): Promise<boolean> {
  const gameSettings = await getSettings(appName)
  const gameInfo = getGameInfo(appName)

  const {
    success: launchPrepSuccess,
    failureReason: launchPrepFailReason,
    rpcClient,
    mangoHudCommand,
    gameModeBin,
    gameScopeCommand,
    steamRuntime,
    offlineMode
  } = await prepareLaunch(gameSettings, logWriter, gameInfo, isNative(appName))
  if (!launchPrepSuccess) {
    logWriter.logError(['Launch aborted:', launchPrepFailReason])
    launchCleanup()
    showDialogBoxModalAuto({
      title: t('box.error.launchAborted', 'Launch aborted'),
      message: launchPrepFailReason!,
      type: 'ERROR'
    })
    return false
  }

  const languageCode = gameSettings.language || configStore.get('language', '')

  let commandEnv = {
    ...process.env,
    ...setupWrapperEnvVars({ appName, appRunner: 'legendary' }),
    ...setupEnvVars(gameSettings, gameInfo.install.install_path),
    ...getKnownFixesEnvVariables(appName, 'legendary')
  }

  // Use the wrapper EXE to launch games.
  if (
    ![undefined, '0', 'false'].includes(commandEnv['USE_FAKE_EPIC_EXE']) &&
    existsSync(fakeEpicExePath)
  ) {
    if (isWindows) {
      commandEnv['LEGENDARY_WRAPPER_EXE'] = fakeEpicExePath
    } else {
      // on linux and mac, we copy the fake exe
      const fakeExeWinPath = 'C:\\windows\\command\\EpicGamesLauncher.exe'
      const fakeEpicExePathInPrefix = await getWinePath({
        path: fakeExeWinPath,
        gameSettings,
        variant: 'unix'
      })

      // we copy the file inside the prefix to avoid permission issues
      if (!existsSync(fakeEpicExePathInPrefix))
        copyFileSync(fakeEpicExePath, fakeEpicExePathInPrefix)
      commandEnv['LEGENDARY_WRAPPER_EXE'] = fakeExeWinPath
    }
  }

  const wrappers = setupWrappers(
    gameSettings,
    mangoHudCommand,
    gameModeBin,
    gameScopeCommand,
    steamRuntime?.length ? [...steamRuntime] : undefined
  )

  let wineFlags: AllowedWineFlags = wrappers.length
    ? { '--wrapper': NonEmptyString.parse(shlex.join(wrappers)) }
    : {}

  if (!isNative(appName)) {
    // -> We're using Wine/Proton on Linux or CX on Mac
    const {
      success: wineLaunchPrepSuccess,
      failureReason: wineLaunchPrepFailReason,
      envVars: wineEnvVars
    } = await prepareWineLaunch('legendary', appName, logWriter)
    if (!wineLaunchPrepSuccess) {
      logWriter.logError(['Launch aborted:', wineLaunchPrepFailReason])
      if (wineLaunchPrepFailReason) {
        showDialogBoxModalAuto({
          title: t('box.error.launchAborted', 'Launch aborted'),
          message: wineLaunchPrepFailReason,
          type: 'ERROR'
        })
      }
      return false
    }

    commandEnv = {
      ...commandEnv,
      ...wineEnvVars
    }

    if (await isUmuSupported(gameSettings)) {
      const umuId = await getUmuId(gameInfo.app_name, gameInfo.runner)
      if (umuId) {
        commandEnv['GAMEID'] = umuId
      }
    }

    wineFlags = await getWineFlags(gameSettings, shlex.join(wrappers))
  }

  const appNameToLaunch =
    launchArguments?.type === 'dlc' ? launchArguments.dlcAppName : appName

  const launchArgumentArgs =
    launchArguments &&
    (launchArguments.type === undefined || launchArguments.type === 'basic')
      ? launchArguments.parameters
      : undefined

  const command: LegendaryCommand = {
    subcommand: 'launch',
    appName: LegendaryAppName.parse(appNameToLaunch),
    extraArguments: [...args, launchArgumentArgs, gameSettings.launcherArgs]
      .filter(Boolean)
      .join(' '),
    ...wineFlags
  }
  if (skipVersionCheck) command['--skip-version-check'] = true
  if (languageCode) command['--language'] = NonEmptyString.parse(languageCode)
  if (launchArguments?.type === 'altExe')
    command['--override-exe'] = launchArguments.executable
  else if (gameSettings.targetExe)
    command['--override-exe'] = Path.parse(gameSettings.targetExe)
  if (offlineMode) command['--offline'] = true
  if (isCLINoGui) command['--skip-version-check'] = true
  if (gameInfo.isEAManaged) command['--origin'] = true
  if (gameInfo.isUbisoftManaged) command['--ubisoft'] = true

  sendGameStatusUpdate({ appName, runner: 'legendary', status: 'playing' })

  const { error } = await runLegendaryCommand(command, {
    abortId: appName,
    env: commandEnv,
    wrappers: wrappers,
    logMessagePrefix: `Launching ${gameInfo.title}`,
    logWriters: gameSettings.verboseLogs ? [logWriter] : []
  })

  launchCleanup(rpcClient)

  return !error
}

export function isNative(appName: string): boolean {
  const gameInfo = getGameInfo(appName)

  if (isWindows) {
    return true
  }

  if (isMac && gameInfo?.install?.platform === 'Mac') {
    return true
  }

  return false
}

export async function forceUninstall(appName: string) {
  // Modify Legendary installed.json file:
  try {
    await runLegendaryCommand(
      {
        subcommand: 'uninstall',
        appName: LegendaryAppName.parse(appName),
        '-y': true,
        '--keep-files': true
      },
      {
        abortId: appName
      }
    )

    sendFrontendMessage('refreshLibrary', 'legendary')
  } catch (error) {
    logError(
      [
        `Error reading ${legendaryInstalled}, could not complete operation:`,
        error
      ],
      LogPrefix.Legendary
    )
  }
}

// Could be removed if legendary handles SIGKILL and SIGTERM for us
// which is send via AbortController
export async function stop(appName: string, stopWine = true) {
  // until the legendary bug gets fixed, kill legendary on mac
  // not a perfect solution but it's the only choice for now

  // @adityaruplaha: this is kinda arbitary and I don't understand it.
  const pattern = isWindows ? 'legendary' : appName
  killPattern(pattern)

  if (stopWine && !isNative(appName)) {
    const gameSettings = await getSettings(appName)
    await shutdownWine(gameSettings)
  }
}

export async function isGameAvailable(appName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const info = getGameInfo(appName)
    if (info && info.is_installed) {
      if (info.install.install_path && existsSync(info.install.install_path)) {
        resolve(true)
      } else {
        resolve(false)
      }
    }
    resolve(false)
  })
}

export async function runWineCommandOnGame(
  appName: string,
  { commandParts, wait = false, protonVerb, startFolder }: WineCommandArgs
): Promise<ExecResult> {
  if (isNative(appName)) {
    logError('runWineCommand called on native game!', LogPrefix.Legendary)
    return { stdout: '', stderr: '' }
  }

  const { folder_name, install } = getGameInfo(appName)
  const gameSettings = await getSettings(appName)

  return runWineCommandUtil({
    gameSettings,
    gameInstallPath: install.install_path,
    installFolderName: folder_name,
    commandParts,
    wait,
    protonVerb,
    startFolder
  })
}
