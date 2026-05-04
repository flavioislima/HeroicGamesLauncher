import { LogPrefix, logError, logInfo, logWarning } from 'backend/logger'
import { ExecResult, GameInfo, InstallPlatform } from 'common/types'
import {
  HumbleDownload,
  HumbleDownloadStruct,
  HumbleInstallInfo,
  HumbleInstalledInfo,
  HumbleInstallPlatform,
  HumbleOrder,
  HumbleSubproduct
} from 'common/types/humble'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'graceful-fs'
import {
  humbleConfigPath,
  humbleInstalledPath,
  humbleOrdersCachePath
} from './constants'
import { installStore, libraryStore } from './electronStores'
import { HumbleUser } from './user'
import { getAllOrders, isUnauthorized } from './api'
import { discoverArtworkForMany, getCachedArtwork } from './artwork'
import { sendFrontendMessage } from '../../ipc'
import { getFileSize } from 'backend/utils'

// Humble's macOS catalog is overwhelmingly x86_64-only; trying to launch
// those binaries on Apple Silicon trips EBADARCH and Node's spawn() doesn't
// trigger Rosetta. Until Humble's manifest exposes per-binary architecture,
// the safe default is to hide the macOS option on Apple Silicon entirely
// and let those users install via Wine/CrossOver instead. Intel Macs see
// the macOS option as normal.
const hideMacBecauseAppleSilicon =
  process.platform === 'darwin' && process.arch === 'arm64'

const installedGames: Map<string, HumbleInstalledInfo> = new Map()
const library: Map<string, GameInfo> = new Map()

export async function initHumbleLibraryManager() {
  return await new Promise<void>((resolve) => {
    mkdirSync(humbleConfigPath, { recursive: true })
    refreshInstalled()
    loadOrdersFromDisk()
    rebuildLibrary()
    resolve()
  })
}

function loadOrdersFromDisk() {
  try {
    const orders = JSON.parse(
      readFileSync(humbleOrdersCachePath, 'utf-8')
    ) as HumbleOrder[]
    cacheOrders(orders)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    logError(['Could not parse cached orders.json:', error], LogPrefix.Humble)
  }
}

const cachedSubproducts: Map<
  string,
  { order: HumbleOrder; subproduct: HumbleSubproduct }
> = new Map()

function cacheOrders(orders: HumbleOrder[]) {
  cachedSubproducts.clear()
  for (const order of orders) {
    for (const subproduct of order.subproducts ?? []) {
      if (!hasInstallableDownload(subproduct)) continue
      cachedSubproducts.set(subproduct.machine_name, { order, subproduct })
    }
  }
}

// Humble's Linux downloads are a mix of .deb/.rpm/.sh — no portable install
// strategy across distros, so Linux still goes through Wine/Proton.
function isWindowsDownload(d: HumbleDownload): boolean {
  return d.platform === 'windows' && Boolean(d.download_struct?.length)
}

// Humble tags macOS downloads as either "mac" or "osx" depending on when the
// product was uploaded — accept both.
function isMacDownload(d: HumbleDownload): boolean {
  return (
    (d.platform === 'mac' || d.platform === 'osx') &&
    Boolean(d.download_struct?.length)
  )
}

function hasMacDownload(subproduct: HumbleSubproduct): boolean {
  return Boolean(subproduct.downloads?.some(isMacDownload))
}

function hasInstallableDownload(subproduct: HumbleSubproduct): boolean {
  // On Apple Silicon a mac-only subproduct has no path to launch (the binary
  // would be x86_64 and Node's spawn won't auto-translate via Rosetta), so
  // hide it instead of leaving a broken entry in the library.
  if (hideMacBecauseAppleSilicon) {
    return Boolean(subproduct.downloads?.some(isWindowsDownload))
  }
  return Boolean(
    subproduct.downloads?.some(
      (d) => isWindowsDownload(d) || isMacDownload(d)
    )
  )
}

function normalizePlatform(
  platform?: string
): HumbleInstallPlatform | undefined {
  if (!platform) return undefined
  const lower = platform.toLowerCase()
  if (lower === 'windows' || lower === 'win32') return 'windows'
  if (lower === 'mac' || lower === 'osx' || lower === 'darwin') return 'osx'
  if (lower === 'linux') return 'linux'
  return undefined
}

function pickPreferredDownload(
  subproduct: HumbleSubproduct,
  preferredPlatform: HumbleInstallPlatform = 'windows'
):
  | {
      download: HumbleDownload
      struct: HumbleDownloadStruct
      platform: HumbleInstallPlatform
    }
  | undefined {
  const matcher =
    preferredPlatform === 'osx' ? isMacDownload : isWindowsDownload
  const dl = subproduct.downloads?.find(matcher)
  if (!dl) {
    // Fall back to whatever installable platform we *do* have so that a stale
    // platform request (e.g. the cached install record says "windows" but the
    // user only owns the mac build) still returns something usable.
    if (preferredPlatform === 'osx') {
      return pickPreferredDownload(subproduct, 'windows')
    }
    const macDl = subproduct.downloads?.find(isMacDownload)
    if (!macDl) return undefined
    const macStruct = macDl.download_struct.find((s) => s.url?.web)
    if (!macStruct) return undefined
    return { download: macDl, struct: macStruct, platform: 'osx' }
  }
  const struct = dl.download_struct.find((s) => s.url?.web)
  if (!struct) return undefined
  return { download: dl, struct, platform: preferredPlatform }
}

function subproductToGameInfo(
  order: HumbleOrder,
  subproduct: HumbleSubproduct
): GameInfo | undefined {
  const preferred = pickPreferredDownload(subproduct)
  if (!preferred) return undefined

  const installed = installedGames.get(subproduct.machine_name)
  const artwork = getCachedArtwork(subproduct.machine_name)
  const betterArt = artwork?.url
  const fallbackIcon = subproduct.icon ?? ''

  return {
    app_name: subproduct.machine_name,
    runner: 'humble',
    title: subproduct.human_name,
    art_cover: betterArt ?? fallbackIcon,
    art_square: betterArt ?? fallbackIcon,
    art_background: betterArt ?? fallbackIcon,
    art_logo: subproduct.icon,
    is_installed: Boolean(installed),
    canRunOffline: true,
    is_linux_native: false,
    is_mac_native:
      !hideMacBecauseAppleSilicon && hasMacDownload(subproduct),
    developer: subproduct.payee?.human_name,
    description: subproduct.human_name,
    folder_name: subproduct.machine_name,
    install: installed
      ? {
          install_path: installed.install_path,
          install_size: getFileSize(installed.install_size),
          version: installed.version,
          platform: installed.platform as InstallPlatform,
          executable: installed.executable
        }
      : {},
    extra: {
      reqs: [],
      genres: [],
      releaseDate: order.created
    }
  }
}

function rebuildLibrary() {
  library.clear()
  for (const { order, subproduct } of cachedSubproducts.values()) {
    const info = subproductToGameInfo(order, subproduct)
    if (info) library.set(subproduct.machine_name, info)
  }
  libraryStore.set('library', Array.from(library.values()))
}

export async function refresh(): Promise<ExecResult | null> {
  if (!HumbleUser.isLoggedIn()) {
    return { stdout: '', stderr: '' }
  }
  logInfo('Refreshing Humble Bundle library...', LogPrefix.Humble)
  try {
    const orders = await getAllOrders()
    writeFileSync(humbleOrdersCachePath, JSON.stringify(orders), 'utf-8')
    cacheOrders(orders)
    refreshInstalled()
    rebuildLibrary()
    logInfo(
      ['Loaded', `${library.size}`, 'Humble DRM-free games'],
      LogPrefix.Humble
    )

    const subproductsToEnrich = Array.from(cachedSubproducts.values()).map(
      ({ subproduct }) => ({
        machine_name: subproduct.machine_name,
        human_name: subproduct.human_name
      })
    )
    discoverArtworkForMany(subproductsToEnrich)
      .then(() => {
        rebuildLibrary()
        // Force the renderer to re-read artwork; otherwise users keep seeing
        // the small Humble icons until the next manual refresh.
        sendFrontendMessage('refreshLibrary', 'humble')
      })
      .catch((error) => {
        logWarning(
          ['Humble artwork enrichment failed:', error],
          LogPrefix.Humble
        )
      })

    return { stdout: '', stderr: '' }
  } catch (error) {
    if (isUnauthorized(error)) {
      logWarning(
        'Humble session expired, user needs to log in again',
        LogPrefix.Humble
      )
      await HumbleUser.logout()
    } else {
      logError(['Failed to refresh Humble library:', error], LogPrefix.Humble)
    }
    return { stdout: '', stderr: `${error}` }
  }
}

export function getGameInfo(
  appName: string,
  forceReload = false
): GameInfo | undefined {
  if (!forceReload) {
    const cached = library.get(appName)
    if (cached) return cached
  }
  const entry = cachedSubproducts.get(appName)
  if (!entry) return undefined
  refreshInstalled()
  const info = subproductToGameInfo(entry.order, entry.subproduct)
  if (info) library.set(appName, info)
  return info
}

export async function getInstallInfo(
  appName: string,
  installPlatform?: string
): Promise<HumbleInstallInfo | undefined> {
  const requestedPlatform = normalizePlatform(installPlatform) ?? 'windows'
  // Cache per-platform so switching between Windows/Mac in the install dialog
  // doesn't return a stale entry.
  const cacheKey = `${appName}__${requestedPlatform}`
  const cached = installStore.get(cacheKey)
  if (cached) return cached

  const entry = cachedSubproducts.get(appName)
  if (!entry) {
    logError(['Could not find Humble subproduct', appName], LogPrefix.Humble)
    return undefined
  }
  const preferred = pickPreferredDownload(entry.subproduct, requestedPlatform)
  if (!preferred) return undefined
  const info: HumbleInstallInfo = {
    game: {
      app_name: appName,
      title: entry.subproduct.human_name,
      version: preferred.struct.md5.slice(0, 8),
      platform: preferred.platform,
      machine_name: entry.subproduct.machine_name,
      gamekey: entry.order.gamekey
    },
    manifest: {
      download_size: preferred.struct.file_size,
      disk_size: preferred.struct.file_size,
      md5: preferred.struct.md5,
      download_url: preferred.struct.url.web
    }
  }
  installStore.set(cacheKey, info)
  return info
}

export async function listUpdateableGames(): Promise<string[]> {
  if (!HumbleUser.isLoggedIn()) return []
  const updates: string[] = []
  for (const [appName, installed] of installedGames.entries()) {
    const entry = cachedSubproducts.get(appName)
    if (!entry) continue
    const preferred = pickPreferredDownload(
      entry.subproduct,
      installed.platform
    )
    if (!preferred) continue
    if (preferred.struct.md5 && preferred.struct.md5 !== installed.md5) {
      updates.push(appName)
    }
  }
  if (updates.length) {
    logInfo(
      ['Found', `${updates.length}`, 'Humble games to update'],
      LogPrefix.Humble
    )
  }
  return updates
}

export function getCachedSubproduct(appName: string) {
  return cachedSubproducts.get(appName)
}

export function getInstalled(appName: string): HumbleInstalledInfo | undefined {
  return installedGames.get(appName)
}

export function refreshInstalled() {
  installedGames.clear()
  if (!existsSync(humbleInstalledPath)) return
  try {
    const arr = JSON.parse(
      readFileSync(humbleInstalledPath, 'utf-8')
    ) as HumbleInstalledInfo[]
    for (const item of arr) installedGames.set(item.app_name, item)
  } catch (error) {
    logError(['Corrupted Humble installed.json:', error], LogPrefix.Humble)
  }
}

export function persistInstalled(info: HumbleInstalledInfo) {
  installedGames.set(info.app_name, info)
  writeAllInstalled()
}

export function removeInstalled(appName: string) {
  installedGames.delete(appName)
  installStore.delete(`${appName}__windows`)
  installStore.delete(`${appName}__osx`)
  writeAllInstalled()
}

function writeAllInstalled() {
  mkdirSync(humbleConfigPath, { recursive: true })
  writeFileSync(
    humbleInstalledPath,
    JSON.stringify(Array.from(installedGames.values())),
    'utf-8'
  )
}

export async function changeGameInstallPath(appName: string, newPath: string) {
  const installed = installedGames.get(appName)
  if (!installed) {
    logWarning(
      `Cannot change install path: no record of ${appName}`,
      LogPrefix.Humble
    )
    return
  }
  installed.install_path = newPath
  installedGames.set(appName, installed)
  writeAllInstalled()
  const game = library.get(appName)
  if (game) game.install.install_path = newPath
}

export function installState(appName: string, state: boolean) {
  if (!state) {
    removeInstalled(appName)
    const game = library.get(appName)
    if (game) {
      game.is_installed = false
      game.install = {}
    }
    persistLibraryStore()
    return
  }
  const installed = installedGames.get(appName)
  const game = library.get(appName)
  if (game && installed) {
    game.is_installed = true
    game.install = {
      install_path: installed.install_path,
      install_size: getFileSize(installed.install_size),
      version: installed.version,
      platform: installed.platform as InstallPlatform,
      executable: installed.executable
    }
  }
  persistLibraryStore()
}

// `library` is the in-memory authoritative copy; the renderer reads its
// snapshot from electron-store directly on refresh, so we must mirror any
// install/uninstall mutation back to disk or the library list keeps showing
// stale state until the next full re-fetch.
function persistLibraryStore() {
  libraryStore.set('library', Array.from(library.values()))
}

export const getLaunchOptions = () => []

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function changeVersionPinnedStatus(_appName: string, _status: boolean) {
  logWarning(
    'changeVersionPinnedStatus not implemented for Humble',
    LogPrefix.Humble
  )
}
