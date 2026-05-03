import {
  LogPrefix,
  logDebug,
  logError,
  logInfo,
  logWarning
} from 'backend/logger'
import { CallRunnerOptions, ExecResult, GameInfo } from 'common/types'
import {
  EAGameInfo,
  EAGameDownloadInfo,
  EAInstallInfo,
  EAInstallMetadataInfo
} from 'common/types/ea'
import { existsSync, readFileSync, writeFileSync } from 'graceful-fs'
import { installStore, libraryStore } from './electronStores'
import { getEABin, getFileSize, removeSpecialcharacters } from 'backend/utils'
import { callRunner } from 'backend/launcher'
import { dirname, join } from 'path'
import { app } from 'electron'
import { copySync } from 'fs-extra'
import { EAUser } from './user'
import { runEACommandStub } from './e2eMock'
import { eaConfigPath, eaInstalled, eaLibrary } from './constants'
import { GlobalConfig } from 'backend/config'

const installedGames: Map<string, EAInstallMetadataInfo> = new Map()
const library: Map<string, GameInfo> = new Map()

function eaSupportEnabled(): boolean {
  return Boolean(
    GlobalConfig.get().getSettings().experimentalFeatures?.eaSupport
  )
}

export async function initEALibraryManager() {
  if (!eaSupportEnabled()) return

  // Migrate user data from a global Maxima install if the user already
  // ran it once outside Heroic. Mirrors the Nile bootstrap.
  const globalMaximaConfig = join(app.getPath('appData'), 'maxima')
  if (!existsSync(eaConfigPath) && existsSync(globalMaximaConfig)) {
    copySync(globalMaximaConfig, eaConfigPath)
    await EAUser.getUserData()
  }

  refresh()
}

/**
 * Loads all the user's games into `library` from the JSON cache that
 * the helper binary writes after `library sync`.
 */
function loadGamesInAccount() {
  if (!existsSync(eaLibrary)) {
    return
  }

  let libraryJSON: EAGameInfo[]
  try {
    libraryJSON = JSON.parse(readFileSync(eaLibrary, 'utf-8'))
  } catch (error) {
    logError(['Could not parse EA library.json:', error], LogPrefix.EA)
    return
  }

  libraryJSON.forEach((game) => {
    const { product, slug } = game
    const { title, productDetail } = product
    const {
      details: {
        shortDescription,
        developer,
        genres,
        releaseDate,
        backgroundUrl,
        logoUrl
      },
      iconUrl
    } = productDetail

    const info = installedGames.get(product.id)
    const safeFolderName = removeSpecialcharacters(title ?? slug ?? product.id)

    library.set(product.id, {
      app_name: product.id,
      art_cover: backgroundUrl || iconUrl,
      art_logo: logoUrl,
      art_background: backgroundUrl,
      art_square: iconUrl,
      // EA's licensing model requires periodic online checks for most
      // titles. Mark canRunOffline conservatively until we model
      // per-title offline allowances (see Maxima's OOA license decoder).
      canRunOffline: false,
      install: info
        ? {
            install_path: info.path,
            install_size: getFileSize(info.size ?? 0),
            version: info.version,
            platform: 'Windows'
          }
        : {},
      folder_name: safeFolderName,
      is_installed: info !== undefined,
      runner: 'ea',
      title: title ?? slug ?? '???',
      description: shortDescription,
      developer,
      extra: {
        reqs: [],
        genres,
        releaseDate
      },
      is_linux_native: false,
      is_mac_native: false
    })
  })
}

export function removeFromInstalledConfig(appName: string) {
  installedGames.clear()
  if (existsSync(eaInstalled)) {
    try {
      const installed: EAInstallMetadataInfo[] = JSON.parse(
        readFileSync(eaInstalled, 'utf-8')
      )
      const newInstalled = installed.filter((game) => game.id !== appName)
      writeFileSync(eaInstalled, JSON.stringify(newInstalled), 'utf-8')
    } catch (error) {
      logError(
        ['Corrupted installed.json file, cannot load installed games', error],
        LogPrefix.EA
      )
    }
  }
}

export async function listUpdateableGames(): Promise<string[]> {
  if (!eaSupportEnabled() || !EAUser.isLoggedIn()) return []
  logInfo('Looking for EA updates...', LogPrefix.EA)

  // Maxima exposes `available_builds(offer_id)` and `live_build()` per
  // game; there is no single `list-updates` subcommand yet. Until
  // upstream adds one, we walk our installed games and let the install
  // pipeline handle build comparisons. Returning [] keeps the auto-
  // update path silent rather than spamming false positives.
  const updates: string[] = []
  return updates
}

async function refreshEA(): Promise<ExecResult> {
  logInfo('Refreshing EA games...', LogPrefix.EA)

  // `list-games` is the closest thing Maxima ships today. When a JSON
  // output is available we should pipe it directly into eaLibrary;
  // until then this just primes the helper's local cache.
  const res = await runRunnerCommand(['list-games'], {
    abortId: 'ea-refresh'
  })

  if (res.error) {
    logError(['Failed to refresh EA library:', res.error], LogPrefix.EA)
  }
  return { stderr: '', stdout: '' }
}

export function getInstallMetadata(
  appName: string
): EAInstallMetadataInfo | undefined {
  if (!existsSync(eaInstalled)) return

  try {
    const installed: EAInstallMetadataInfo[] = JSON.parse(
      readFileSync(eaInstalled, 'utf-8')
    )
    return installed.find((game) => game.id === appName)
  } catch (error) {
    logError(
      ['Corrupted installed.json file, cannot load installed games', error],
      LogPrefix.EA
    )
  }
  return
}

export function refreshInstalled() {
  installedGames.clear()
  if (existsSync(eaInstalled)) {
    try {
      const installed: EAInstallMetadataInfo[] = JSON.parse(
        readFileSync(eaInstalled, 'utf-8')
      )
      installed.forEach((metadata) => {
        installedGames.set(metadata.id, metadata)
      })
    } catch (error) {
      logError(
        ['Corrupted installed.json file, cannot load installed games', error],
        LogPrefix.EA
      )
    }
  }
}

const defaultExecResult = { stderr: '', stdout: '' }

export async function refresh(): Promise<ExecResult | null> {
  if (!eaSupportEnabled() || !EAUser.isLoggedIn()) {
    return defaultExecResult
  }
  logInfo('Refreshing EA library...', LogPrefix.EA)

  await refreshEA()
  refreshInstalled()
  loadGamesInAccount()

  const arr = Array.from(library.values())
  libraryStore.set('library', arr)
  logInfo(['EA game list updated, got', `${arr.length}`, 'games'], LogPrefix.EA)

  return defaultExecResult
}

export function getGameInfo(
  appName: string,
  forceReload = false
): GameInfo | undefined {
  if (!forceReload) {
    const gameInMemory = library.get(appName)
    if (gameInMemory) {
      return gameInMemory
    }
  }

  logInfo(['Loading', appName, 'from EA metadata files'], LogPrefix.EA)
  refreshInstalled()
  loadGamesInAccount()

  const game = library.get(appName)
  if (!game) {
    logError(
      ['Could not find EA game', appName, "in user's library"],
      LogPrefix.EA
    )
    return
  }
  return game
}

export async function getInstallInfo(appName: string): Promise<EAInstallInfo> {
  const cache = installStore.get(appName)
  if (cache) {
    logDebug('Using cached EA install info', LogPrefix.EA)
    return cache
  }

  logInfo('Getting EA install info', LogPrefix.EA)
  refreshInstalled()

  const game = library.get(appName)
  const metadata = installedGames.get(appName)

  // Maxima's `available_builds` could give us an exact size, but the CLI
  // only exposes interactive flows. We attempt `get-legacy-catalog-def`
  // which prints catalog info; falling back to 0 when parsing fails.
  let download_size = 0
  try {
    const { stdout } = await runRunnerCommand(
      ['get-legacy-catalog-def', '--offer-id', appName],
      { abortId: appName }
    )
    const sizeMatch = stdout.match(/totalSizeInBytes\D+(\d+)/i)
    if (sizeMatch) {
      const parsed: EAGameDownloadInfo = {
        download_size: Number(sizeMatch[1])
      }
      download_size = parsed.download_size
    }
  } catch (err) {
    logWarning(['Could not get EA download size:', err], LogPrefix.EA)
  }

  if (!game) {
    logError(['Could not find EA game with id', appName], LogPrefix.EA)
    return {
      game: {
        id: '',
        app_name: '',
        title: '',
        version: '',
        path: '',
        is_dlc: false,
        launch_options: [],
        owned_dlc: [],
        cloud_saves_supported: false,
        content_ids: [],
        platform_versions: { Windows: '' }
      },
      manifest: { download_size: 0, disk_size: 0 }
    }
  }

  const installInfo: EAInstallInfo = {
    game: {
      id: appName,
      app_name: game.app_name,
      title: game.title,
      version: metadata?.version ?? '',
      build_id: metadata?.build_id,
      path: metadata?.path ?? '',
      is_dlc: false,
      launch_options: [],
      owned_dlc: [],
      cloud_saves_supported: false,
      content_ids: metadata?.content_ids ?? [],
      platform_versions: { Windows: metadata?.version ?? '' }
    },
    manifest: {
      download_size,
      disk_size: download_size
    }
  }

  installStore.set(appName, installInfo)
  return installInfo
}

export async function changeGameInstallPath(
  appName: string,
  newAppPath: string
) {
  const libraryGameInfo = library.get(appName)
  if (libraryGameInfo) libraryGameInfo.install.install_path = newAppPath
  else {
    logWarning(
      `library game info not found in changeGameInstallPath for ${appName}`,
      LogPrefix.EA
    )
  }

  updateInstalledPathInJSON(appName, newAppPath)
}

function updateInstalledPathInJSON(appName: string, newAppPath: string) {
  refreshInstalled()

  const installedGameInfo = installedGames.get(appName)
  if (installedGameInfo) installedGameInfo.path = newAppPath
  else {
    logWarning(
      `installed game info not found in changeGameInstallPath for ${appName}`,
      LogPrefix.EA
    )
  }

  if (!existsSync(eaInstalled)) {
    logError(['Could not find EA installed.json in', eaInstalled], LogPrefix.EA)
    return
  }

  writeFileSync(
    eaInstalled,
    JSON.stringify(Array.from(installedGames.values())),
    'utf-8'
  )
  logInfo(['Updated EA install path for', appName], LogPrefix.EA)
}

export function installState(appName: string, state: boolean) {
  if (!state) {
    installedGames.delete(appName)
    installStore.delete(appName)
    return
  }

  const metadata = getInstallMetadata(appName)
  if (!metadata) {
    logError(['Could not find EA install metadata for', appName], LogPrefix.EA)
    return
  }
  installedGames.set(appName, metadata)
}

export async function runRunnerCommand(
  commandParts: string[],
  options?: CallRunnerOptions
): Promise<ExecResult> {
  if (process.env.CI === 'e2e') {
    return runEACommandStub(commandParts)
  }

  const { dir, bin } = getEABin()

  if (!options) options = {}
  if (!options.env) options.env = {}
  // Maxima reads its own config from $XDG_CONFIG_HOME/maxima or
  // %APPDATA%/maxima by default. Point it at our isolated dir so a
  // standalone Maxima install on the same box doesn't clash with us.
  // `MAXIMA_CONFIG_PATH` is the contract we'd want upstream; until it
  // lands we pre-set XDG_CONFIG_HOME to the parent of `eaConfigPath`.
  options.env.MAXIMA_CONFIG_PATH = dirname(eaConfigPath)
  options.env.XDG_CONFIG_HOME = dirname(dirname(eaConfigPath))

  return callRunner(
    commandParts,
    { name: 'ea', logPrefix: LogPrefix.EA, bin, dir },
    options
  )
}

export const getLaunchOptions = () => []

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export function changeVersionPinnedStatus(appName: string, status: boolean) {
  logWarning('changeVersionPinnedStatus not implemented on EA Library Manager')
}
