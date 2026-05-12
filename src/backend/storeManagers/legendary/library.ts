import { existsSync, mkdirSync, readFileSync, readdirSync } from 'graceful-fs'

import {
  GameInfo,
  InstalledInfo,
  CallRunnerOptions,
  ExecResult,
  InstallPlatform,
  LaunchOption
} from 'common/types'
import {
  InstalledJsonMetadata,
  GameMetadata,
  LegendaryInstallInfo,
  LegendaryInstallPlatform,
  ResponseDataLegendaryAPI,
  SelectiveDownload,
  GameOverride
} from 'common/types/legendary'
import { LegendaryUser } from './user'
import {
  formatEpicStoreUrl,
  getLegendaryBin,
  isEpicServiceOffline,
  getFileSize,
  axiosClient
} from '../../utils'
import {
  logDebug,
  logError,
  logInfo,
  LogPrefix,
  logWarning
} from 'backend/logger'
import {
  gamesOverrideStore,
  installStore,
  libraryStore
} from './electronStores'
import { callRunner } from '../../launcher'
import { dirname, join } from 'path'
import { isOnline } from 'backend/online_monitor'
import { update } from './games'
import { LegendaryCommand } from './commands'
import { LegendaryAppName, LegendaryPlatform } from './commands/base'
import { Path } from 'backend/schemas'
import shlex from 'shlex'
import thirdParty from './thirdParty'
import { Entries } from 'type-fest'
import { runLegendaryCommandStub } from './e2eMock'
import { legendaryConfigPath, legendaryMetadata } from './constants'
import { isWindows } from 'backend/constants/environment'

const fallBackImage = 'fallback'

const allGames: Set<string> = new Set()
let installedGames: Map<string, InstalledJsonMetadata> = new Map()
const library: Map<string, GameInfo> = new Map()

export async function initLegendaryLibraryManager() {
  loadGamesInAccount()
  refreshInstalled()
}

/**
 * Loads all of the user's games into `allGames`
 */
export function loadGamesInAccount() {
  if (!existsSync(legendaryMetadata)) {
    return
  }
  readdirSync(legendaryMetadata).forEach((filename) => {
    // This shouldn't ever happen, but just in case
    if (!filename.endsWith('.json')) {
      return
    }
    const appName = filename.split('.').slice(0, -1).join('.')
    allGames.add(appName)
  })
}

/**
 * Refresh games in the user's library.
 */
async function refreshLegendary(): Promise<ExecResult> {
  logInfo('Refreshing Epic Games...', LogPrefix.Legendary)
  const epicOffline = await isEpicServiceOffline()
  if (epicOffline) {
    logWarning(
      'Epic is Offline right now, cannot update game list!',
      LogPrefix.Backend
    )
    return { stderr: 'Epic offline, unable to update game list', stdout: '' }
  }

  const res = await runRunnerCommand(
    {
      subcommand: 'list',
      '--third-party': true
    },
    {
      abortId: 'legendary-refresh'
    }
  )

  if (res.error) {
    logError(['Failed to refresh library:', res.error], LogPrefix.Legendary)
  }
  refreshInstalled()
  return res
}

/**
 * Refresh `installedGames` from file.
 */
export function refreshInstalled() {
  const installedJSON = join(legendaryConfigPath, 'installed.json')

  let installedCache: [string, InstalledJsonMetadata][] = []
  if (existsSync(installedJSON)) {
    try {
      installedCache = Object.entries(
        JSON.parse(readFileSync(installedJSON, 'utf-8'))
      )
    } catch (error) {
      // disabling log here because its giving false positives on import command
      logError(
        ['Corrupted installed.json file, cannot load installed games', error],
        LogPrefix.Legendary
      )
      installedCache = []
    }
  } else {
    installedCache = []
  }

  const thirdPartyGames = thirdParty.getInstalledGames()
  installedCache.push(...thirdPartyGames)

  installedGames = new Map(installedCache)
}

const defaultExecResult = {
  stderr: '',
  stdout: ''
}

/**
 * Get the game info of all games in the library
 *
 * @returns Array of objects.
 */
export async function refresh(): Promise<ExecResult | null> {
  logInfo('Refreshing library...', LogPrefix.Legendary)
  if (!LegendaryUser.isLoggedIn()) {
    return defaultExecResult
  }

  await refreshLegendary()
  loadGamesInAccount()
  refreshInstalled()

  try {
    await loadAll()
  } catch (error) {
    logError(error, LogPrefix.Legendary)
  }
  const arr = Array.from(library.values())
  libraryStore.set('library', arr)
  logInfo(
    ['Game list updated, got', `${arr.length}`, 'games & DLCs'],
    LogPrefix.Legendary
  )
  return defaultExecResult
}

export function getListOfGames() {
  return libraryStore.get('library', [])
}

/**
 * Get game info for a particular game.
 *
 * @param appName The AppName of the game you want the info of
 * @param forceReload Discards game info in `library` and always reads info from metadata files
 * @returns GameInfo
 */
export function getGameInfo(
  appName: string,
  forceReload = false
): GameInfo | undefined {
  if (!hasGame(appName)) {
    logWarning(
      ['Requested game', appName, 'was not found in library'],
      LogPrefix.Legendary
    )
    return undefined
  }
  // We have the game, but info wasn't loaded yet
  if (!library.has(appName) || forceReload) {
    loadFile(appName)
  }
  return library.get(appName)
}

/**
 * Get game info for a particular game.
 */
export async function getInstallInfo(
  appName: string,
  installPlatform: InstallPlatform,
  options?: { retries?: number }
): Promise<LegendaryInstallInfo> {
  const retries = options?.retries

  const cache = installStore.get(appName)
  if (cache && cache.manifest) {
    logDebug('Using cached install info', LogPrefix.Legendary)
    return cache
  }

  logInfo(`Getting more details with 'legendary info'`, LogPrefix.Legendary)
  const command: LegendaryCommand = {
    subcommand: 'info',
    appName: LegendaryAppName.parse(appName),
    '--json': true,
    '--platform': LegendaryPlatform.parse(installPlatform)
  }
  if (await isEpicServiceOffline()) {
    command['--offline'] = true
  }
  const res = await runRunnerCommand(command, { abortId: appName })

  if (res.error) {
    logError(['Failed to get more details:', res.error], LogPrefix.Legendary)
  }
  try {
    const info: LegendaryInstallInfo = JSON.parse(res.stdout)
    if (info.manifest) {
      installStore.set(appName, info)
      return info
    } else {
      const nextRetry = retries !== undefined ? retries - 1 : 3
      if (nextRetry > 0) {
        logWarning(
          `Install info for ${appName} does not include manifest data. Retrying.`
        )
        const retriedInfo = await getInstallInfo(appName, installPlatform, {
          retries: nextRetry
        })
        return retriedInfo
      } else {
        throw Error(
          `Install info for ${appName} does not include manifest data after 3 retries.`
        )
      }
    }
  } catch (error) {
    throw Error(`Failed to parse install info for ${appName} with: ${error}`)
  }
}

/**
 * Obtain a list of updateable games.
 *
 * @returns App names of updateable games.
 */
export async function listUpdateableGames(): Promise<string[]> {
  const isLoggedIn = LegendaryUser.isLoggedIn()

  if (!isLoggedIn || !isOnline()) {
    return []
  }
  const epicOffline = await isEpicServiceOffline()
  if (epicOffline) {
    logWarning(
      'Epic servers are offline, cannot check for game updates',
      LogPrefix.Backend
    )
    return []
  }

  const res = await runRunnerCommand(
    { subcommand: 'list', '--third-party': true },
    {
      abortId: 'legendary-check-updates',
      logMessagePrefix: 'Checking for game updates'
    }
  )

  if (res.abort) {
    return []
  }

  if (res.error) {
    logError(
      ['Failed to check for game updates:', res.error],
      LogPrefix.Legendary
    )
    return []
  }

  // Once we ran `legendary list`, `assets.json` will be updated with the newest
  // game versions, and `installed.json` has our currently installed ones
  const installedJsonFile = join(legendaryConfigPath, 'installed.json')
  let installedJson: Record<string, InstalledJsonMetadata> = {}
  try {
    installedJson = JSON.parse(
      readFileSync(installedJsonFile, { encoding: 'utf-8' })
    )
  } catch (error) {
    logWarning(
      ['Failed to parse games from', installedJsonFile, 'with:', error],
      LogPrefix.Legendary
    )
  }

  // First go through all our installed games and store their versions...
  const installedGames: Map<string, { version: string; platform: string }> =
    new Map()
  for (const [appName, data] of Object.entries(installedJson)) {
    installedGames.set(appName, {
      version: data.version,
      platform: data.platform
    })
  }
  // ...and now go through all games in `assets.json` to get the newest version
  // HACK: Same as above,                         ↓ this isn't always `string`, but it works for now
  const assetsJsonFile = join(legendaryConfigPath, 'assets.json')
  let assetsJson: Record<string, Record<string, string>[]> = {}
  try {
    assetsJson = JSON.parse(readFileSync(assetsJsonFile, { encoding: 'utf-8' }))
  } catch (error) {
    logWarning(
      ['Failed to parse games from', assetsJsonFile, 'with:', error],
      LogPrefix.Legendary
    )
  }

  const updateableGames: string[] = []
  for (const [platform, assets] of Object.entries(assetsJson)) {
    installedGames.forEach(
      ({ version: currentVersion, platform: installedPlatform }, appName) => {
        if (installedPlatform === platform) {
          const currentAsset = assets.find((asset) => {
            return asset.app_name === appName
          })
          if (!currentAsset) {
            logWarning(
              [
                'Game with AppName',
                appName,
                'is installed but was not found on account'
              ],
              LogPrefix.Legendary
            )
            return
          }
          const latestVersion = currentAsset.build_version
          if (currentVersion !== latestVersion) {
            logDebug(
              [
                'Update is available for',
                `${appName}:`,
                currentVersion,
                '!=',
                latestVersion
              ],
              LogPrefix.Legendary
            )
            updateableGames.push(appName)
          }
        }
      }
    )
  }
  logInfo(
    [
      'Found',
      `${updateableGames.length}`,
      'game' + (updateableGames.length !== 1 ? 's' : ''),
      'to update'
    ],
    LogPrefix.Legendary
  )
  return updateableGames
}

/**
 * Update all updateable games.
 * Uses `listUpdateableGames` along with `LegendaryGame.update`
 *
 * @returns Array of results of `Game.update`.
 */
export async function updateAllGames() {
  return (
    await Promise.allSettled(
      (await listUpdateableGames()).map(async (appName) => update(appName))
    )
  ).map((res) => {
    if (res.status === 'fulfilled') {
      return res.value
    } else {
      return null
    }
  })
}

/**
 * Change the install path for a given game.
 *
 * DOES NOT MOVE FILES. Use `LegendaryGame.moveInstall` instead.
 *
 * @param appName
 * @param newPath
 */
export async function changeGameInstallPath(appName: string, newPath: string) {
  const libraryGameInfo = library.get(appName)
  if (libraryGameInfo) libraryGameInfo.install.install_path = newPath
  else {
    logWarning(
      `library game info not found in changeGameInstallPath for ${appName}`,
      LogPrefix.Legendary
    )
  }

  const installedGameInfo = installedGames.get(appName)
  if (installedGameInfo) installedGameInfo.install_path = newPath
  else {
    logWarning(
      `installed game info not found in changeGameInstallPath for ${appName}`,
      LogPrefix.Legendary
    )
  }

  const { error } = await runRunnerCommand(
    {
      subcommand: 'move',
      appName: LegendaryAppName.parse(appName),
      newBasePath: Path.parse(dirname(newPath)),
      '--skip-move': true
    },
    {
      abortId: appName
    }
  )

  if (error) {
    logError(
      ['Failed to set install path for', `${appName}:`, error],
      LogPrefix.Legendary
    )
  }
}

/**
 * Change the install state of a game without a complete library reload.
 *
 * @param appName
 * @param state true if its installed, false otherwise.
 */
export function installState(appName: string, state: boolean) {
  if (state) {
    // This assumes that fileName and appName are same.
    // If that changes, this will break.
    loadFile(appName)
  } else {
    // @ts-expect-error TODO: Make sure game info is loaded & appName is valid here
    library.get(appName).is_installed = false
    // @ts-expect-error Same as above
    library.get(appName).install = {} as InstalledInfo
    installedGames.delete(appName)
  }
}

function loadGameMetadata(appName: string): GameMetadata {
  const fullPath = join(legendaryMetadata, appName + '.json')
  return JSON.parse(readFileSync(fullPath, 'utf-8'))
}

/**
 * Load the file completely into our in-memory library.
 * Largely derived from legacy code.
 *
 * @returns True/False, whether or not the file was loaded
 */
function loadFile(app_name: string): boolean {
  let metadata
  try {
    const data = loadGameMetadata(app_name)
    metadata = data.metadata
  } catch (error) {
    logError(
      [`Failed to parse metadata for ${app_name}:`, error],
      LogPrefix.Legendary
    )
    return false
  }
  const { namespace } = metadata

  const ueCategories = ['assets', 'asset-format', 'plugins', 'projects']
  const isUeTitle =
    namespace === 'ue' ||
    !!metadata.categories.find((category) =>
      ueCategories.includes(category.path)
    )

  if (isUeTitle) {
    return false
  }

  const {
    description,
    shortDescription = '',
    keyImages = [],
    title,
    developer,
    dlcItemList,
    releaseInfo,
    customAttributes,
    categories,
    mainGameItem
  } = metadata

  // skip mods from the library
  if (categories.some(({ path }) => path === 'mods')) {
    return false
  }

  // skip games that are only available for Android or iOS, obtanied from the Epic Mobile Store app
  if (
    releaseInfo.every((info) =>
      info.platform?.every((plat) => plat === 'Android' || plat === 'iOS')
    )
  ) {
    return false
  }

  if (!customAttributes) {
    logWarning(['Incomplete metadata for', app_name], LogPrefix.Legendary)
  }

  const dlcs: string[] = []
  const FolderName = customAttributes?.FolderName
  const canRunOffline = customAttributes?.CanRunOffline?.value === 'true'
  const thirdPartyManagedApp =
    customAttributes?.ThirdPartyManagedApp?.value ||
    customAttributes?.ThirdPartyManagedProvider?.value ||
    undefined

  if (dlcItemList) {
    dlcItemList.forEach((v: { releaseInfo: { appId: string }[] }) => {
      if (v.releaseInfo && v.releaseInfo[0]) {
        dlcs.push(v.releaseInfo[0].appId)
      }
    })
  }

  const info = installedGames.get(app_name)
  const {
    executable,
    version,
    install_size,
    install_path,
    platform,
    save_path
  } = info ?? {}

  const saveFolder =
    (platform === 'Mac'
      ? customAttributes?.CloudSaveFolder_MAC?.value
      : customAttributes?.CloudSaveFolder?.value) ?? ''
  const installFolder = FolderName ? FolderName.value : app_name

  const gameBox = keyImages.find(
    ({ type }) => type === 'DieselGameBox' || type === 'OfferImageWide'
  )

  const gameBoxTall = keyImages.find(
    ({ type }) => type === 'DieselGameBoxTall' || type === 'OfferImageTall'
  )

  const gameBoxStore = keyImages.find(
    ({ type }) => type === 'DieselStoreFrontTall'
  )

  const logo = keyImages.find(({ type }) => type === 'DieselGameBoxLogo')

  const art_cover = gameBox ? gameBox.url : undefined
  const art_logo = logo ? logo.url : undefined
  const art_square = gameBoxTall ? gameBoxTall.url : undefined
  const art_square_front = gameBoxStore ? gameBoxStore.url : undefined

  const is_dlc = Boolean(metadata.mainGameItem)

  const convertedSize = install_size ? getFileSize(Number(install_size)) : '0'

  if (releaseInfo && !releaseInfo[0].platform) {
    logWarning(['No platforms info for', app_name], LogPrefix.Legendary)
  }

  let metadataPlatform: LegendaryInstallPlatform[] = []
  // some DLCs don't have a platform value
  if (releaseInfo[0].platform) {
    metadataPlatform = releaseInfo[0].platform
  } else if (mainGameItem && mainGameItem.releaseInfo[0].platform) {
    // when there's no platform, the DLC might reference the base game with the info
    metadataPlatform = mainGameItem.releaseInfo[0].platform
  }

  library.set(app_name, {
    app_name,
    art_cover: art_cover || art_square || fallBackImage,
    art_logo,
    art_square: art_square || art_square_front || art_cover || fallBackImage,
    cloud_save_enabled: Boolean(saveFolder),
    developer,
    extra: {
      about: {
        description,
        shortDescription
      },
      reqs: [],
      storeUrl: formatEpicStoreUrl(title)
    },
    dlcList: dlcItemList,
    folder_name: installFolder,
    install: {
      executable,
      install_path,
      install_size: convertedSize,
      is_dlc,
      version,
      platform
    },
    is_installed: info !== undefined,
    namespace,
    is_mac_native: info ? platform === 'Mac' : metadataPlatform.includes('Mac'),
    save_folder: saveFolder,
    save_path,
    title,
    canRunOffline,
    thirdPartyManagedApp,
    isEAManaged:
      !!thirdPartyManagedApp &&
      ['origin', 'the ea app'].includes(thirdPartyManagedApp.toLowerCase()),
    isUbisoftManaged:
      !!thirdPartyManagedApp &&
      'ubisoftconnect' == thirdPartyManagedApp.toLowerCase(),
    is_linux_native: false,
    runner: 'legendary',
    store_url: formatEpicStoreUrl(title)
  })

  return true
}

/**
 * Fully loads all files in library into memory.
 *
 * @returns App names of loaded files.
 */
async function loadAll(): Promise<string[]> {
  if (existsSync(legendaryMetadata)) {
    const loadedFiles: string[] = []
    allGames.forEach((appName) => {
      const wasLoaded = loadFile(appName)
      if (wasLoaded) {
        loadedFiles.push(appName)
      }
    })
    return loadedFiles
  }
  return []
}

/**
 * Checks if a game is in the users account
 * @param appName The game to search for
 * @returns True = Game is in account, False = Game is not in account
 */
export const hasGame = (appName: string) => allGames.has(appName)

export async function runRunnerCommand(
  command: LegendaryCommand,
  options?: CallRunnerOptions
): Promise<ExecResult> {
  if (process.env.CI === 'e2e') {
    return runLegendaryCommandStub(command)
  }

  const { dir, bin } = getLegendaryBin()

  // Set LEGENDARY_CONFIG_PATH to a custom, Heroic-specific location so user-made
  // changes to Legendary's main config file don't affect us
  if (!options) {
    options = {}
  }
  if (!options.env) {
    options.env = {}
  }

  // if not on a SNAP environment, set the XDG_CONFIG_HOME to the same location as the config file
  if (!process.env.SNAP) {
    options.env.LEGENDARY_CONFIG_PATH = legendaryConfigPath
  }

  const commandParts = commandToArgsArray(command)

  return callRunner(
    commandParts,
    { name: 'legendary', logPrefix: LogPrefix.Legendary, bin, dir },
    options
  )
}

export async function getGameOverride(): Promise<GameOverride> {
  const cached = gamesOverrideStore.get('gamesOverride')
  if (cached) {
    return cached
  }

  try {
    const response = await axiosClient.get<ResponseDataLegendaryAPI>(
      'https://heroic.legendary.gl/v1/version.json'
    )

    if (response.data.game_overrides) {
      gamesOverrideStore.set('gamesOverride', response.data.game_overrides)
    }

    return response.data.game_overrides
  } catch (error) {
    logWarning(['Error fetching Legendary API:', error], LogPrefix.Legendary)
    throw error
  }
}

export async function getGameSdl(
  appName: string
): Promise<SelectiveDownload[]> {
  try {
    const response = await axiosClient.get<Record<string, SelectiveDownload>>(
      `https://heroic.legendary.gl/v1/sdl/${appName}.json`
    )

    // if data type is not a json return empty array
    if (response.headers['content-type'] !== 'application/json') {
      logInfo(
        ['No Selective Download data found for', appName],
        LogPrefix.Legendary
      )
      return []
    }

    const list = Object.keys(response.data)
    const sdlList: SelectiveDownload[] = []

    list.forEach((key) => {
      const { name, description, tags } = response.data[key]
      if (key === '__required') {
        sdlList.unshift({ name, description, tags, required: true })
      } else {
        sdlList.push({ name, description, tags })
      }
    })

    return sdlList
  } catch (error) {
    logWarning(
      ['Error fetching Selective Download data for', appName, error],
      LogPrefix.Legendary
    )
    return []
  }
}

/**
 * Toggles the EGL synchronization on/off based on arguments
 * @param path_or_action On Windows: "unlink" (turn off), "windows" (turn on). On linux/mac: "unlink" (turn off), any other string (prefix path)
 * @returns string with stdout + stderr, or error message
 */
export async function toggleGamesSync(path_or_action: string) {
  if (isWindows) {
    const egl_manifestPath =
      'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'

    if (!existsSync(egl_manifestPath)) {
      mkdirSync(egl_manifestPath, { recursive: true })
    }
  }

  const command: LegendaryCommand = {
    subcommand: 'egl-sync',
    '-y': true
  }

  if (path_or_action === 'unlink') {
    command['--unlink'] = true
  } else {
    command['--enable-sync'] = true
    if (!isWindows) {
      const pathParse = Path.safeParse(path_or_action)
      if (pathParse.success) {
        command['--egl-wine-prefix'] = pathParse.data
      } else {
        return 'Error'
      }
    }
  }

  const { error, stderr, stdout } = await runRunnerCommand(command, {
    abortId: 'toggle-sync'
  })

  if (error) {
    logError(['Failed to toggle EGS-Sync', error], LogPrefix.Legendary)
    return 'Error'
  } else {
    logInfo(`${stdout}`, LogPrefix.Legendary)
    if (stderr.includes('ERROR') || stderr.includes('error')) {
      logError(`${stderr}`, LogPrefix.Legendary)
      return 'Error'
    }
    return `${stdout} - ${stderr}`
  }
}

/*
 * Converts a LegendaryCommand to a parameter list passable to Legendary
 * @param command
 */
export function commandToArgsArray(command: LegendaryCommand): string[] {
  const commandParts: string[] = []

  if (command.subcommand) commandParts.push(command.subcommand)

  // Some commands need special handling
  switch (command.subcommand) {
    case 'install':
      commandParts.push(command.appName)
      if (command.sdlList) {
        commandParts.push('--install-tag=')
        for (const sdlTag of command.sdlList)
          commandParts.push('--install-tag', sdlTag)
      }
      break
    case 'launch':
      commandParts.push(command.appName)
      if (command.extraArguments)
        commandParts.push(...shlex.split(command.extraArguments))
      break
    case 'update':
    case 'info':
    case 'sync-saves':
    case 'uninstall':
    case 'repair':
      commandParts.push(command.appName)
      break
    case 'move':
      commandParts.push(command.appName, command.newBasePath)
      break
    case 'eos-overlay':
      commandParts.push(command.action)
      break
    case 'import':
      commandParts.push(command.appName, command.installationDirectory)
      break
  }

  // Append parameters (anything starting with -)
  for (const [parameter, value] of Object.entries(
    command
  ) as Entries<LegendaryCommand>) {
    if (!parameter.startsWith('-')) continue
    if (!value) continue
    // Boolean values (specifically `true`) have to be handled differently
    // Parameters that have a boolean type are just signified
    // by the parameter being present, they don't have a value.
    // Thus, we only add the key (parameter) here, instead of the key & value
    if (value === true) commandParts.push(parameter)
    else commandParts.push(parameter, value.toString())
  }

  return commandParts
}

export async function getLaunchOptions(
  appName: string
): Promise<LaunchOption[]> {
  const gameInfo = getGameInfo(appName)
  const installPlatform = gameInfo?.install.platform
  if (!installPlatform || gameInfo.thirdPartyManagedApp) return []

  const installInfo = await getInstallInfo(appName, installPlatform)
  const launchOptions: LaunchOption[] = installInfo.game.launch_options

  // Some DLCs are also launch-able
  for (const dlc of installInfo.game.owned_dlc) {
    const installedInfo = installedGames.get(dlc.app_name)
    if (!installedInfo) continue

    // If the DLC itself is executable, push it onto the list
    if (installedInfo.executable) {
      launchOptions.push({
        type: 'dlc',
        dlcAppName: dlc.app_name,
        dlcTitle: dlc.title
      })
      // The one example we've found using this (Unreal Editor for Fortnite)
      // suggests that we should not look at the AdditionalCommandLine custom
      // attribute (below) if this is set
      continue
    }

    // Otherwise, if it specifies additional commandline parameters to pass to
    // the main game, add it as a basic launch option
    let metadata
    try {
      metadata = loadGameMetadata(dlc.app_name)
    } catch (e) {
      logWarning(
        [
          'Failed to load DLC metadata for',
          dlc.app_name,
          '(base game is',
          `${appName}):`,
          e
        ],
        LogPrefix.Legendary
      )
    }
    if (!metadata?.metadata.customAttributes?.AdditionalCommandLine) continue
    launchOptions.push({
      type: 'basic',
      name: dlc.title,
      parameters: metadata.metadata.customAttributes.AdditionalCommandLine.value
    })
  }

  return launchOptions
}

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export function changeVersionPinnedStatus(appName: string, status: boolean) {
  logWarning(
    'changeVersionPinnedStatus not implemented on Legendary Library Manager'
  )
}
