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

const installedGames: Map<string, HumbleInstalledInfo> = new Map()
const library: Map<string, GameInfo> = new Map()

export async function initHumbleLibraryManager() {
  if (!existsSync(humbleConfigPath)) {
    mkdirSync(humbleConfigPath, { recursive: true })
  }
  refreshInstalled()
  loadOrdersFromDisk()
  rebuildLibrary()
}

function loadOrdersFromDisk() {
  if (!existsSync(humbleOrdersCachePath)) return
  try {
    const orders = JSON.parse(
      readFileSync(humbleOrdersCachePath, 'utf-8')
    ) as HumbleOrder[]
    cacheOrders(orders)
  } catch (error) {
    logError(['Could not parse cached orders.json:', error], LogPrefix.Humble)
  }
}

const cachedOrders: Map<string, HumbleOrder> = new Map()
const cachedSubproducts: Map<
  string,
  { order: HumbleOrder; subproduct: HumbleSubproduct }
> = new Map()

function cacheOrders(orders: HumbleOrder[]) {
  cachedOrders.clear()
  cachedSubproducts.clear()
  for (const order of orders) {
    cachedOrders.set(order.gamekey, order)
    for (const subproduct of order.subproducts ?? []) {
      if (!hasInstallableDownload(subproduct)) continue
      cachedSubproducts.set(subproduct.machine_name, { order, subproduct })
    }
  }
}

// MVP scope: only Windows DRM-free downloads are supported. On Linux/Mac
// the game runs through Wine/Proton like every other Heroic runner. Native
// Linux installers were dropped because Humble distributes a mix of .deb,
// .rpm, .sh (MojoSetup) and bare archives — there's no portable install
// strategy across distros, and many "Linux" entries on Humble are actually
// .deb files that fail outright on Arch/Fedora/etc.
function isWindowsDownload(d: HumbleDownload): boolean {
  return d.platform === 'windows' && Boolean(d.download_struct?.length)
}

function hasInstallableDownload(subproduct: HumbleSubproduct): boolean {
  return Boolean(subproduct.downloads?.some(isWindowsDownload))
}

function pickPreferredDownload(subproduct: HumbleSubproduct):
  | {
      download: HumbleDownload
      struct: HumbleDownloadStruct
      platform: HumbleInstallPlatform
    }
  | undefined {
  const dl = subproduct.downloads?.find(isWindowsDownload)
  if (!dl) return undefined
  const struct = dl.download_struct.find((s) => s.url?.web)
  if (!struct) return undefined
  return { download: dl, struct, platform: 'windows' }
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
    is_mac_native: false,
    developer: subproduct.payee?.human_name,
    description: subproduct.human_name,
    folder_name: subproduct.machine_name,
    install: installed
      ? {
          install_path: installed.install_path,
          install_size: humanSize(installed.install_size),
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

function humanSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
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
    // First pass with whatever artwork we already have cached, so the user
    // sees their library immediately. Then look up Steam artwork for any
    // new titles in the background and rebuild once done.
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
        // Tell the renderer to re-read the cache, otherwise users keep
        // staring at the small Humble icons until the next manual refresh.
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
  refreshInstalled()
  rebuildLibrary()
  return library.get(appName)
}

export async function getInstallInfo(
  appName: string
): Promise<HumbleInstallInfo | undefined> {
  const cached = installStore.get(appName)
  if (cached) return cached

  const entry = cachedSubproducts.get(appName)
  if (!entry) {
    logError(['Could not find Humble subproduct', appName], LogPrefix.Humble)
    return undefined
  }
  const preferred = pickPreferredDownload(entry.subproduct)
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
  installStore.set(appName, info)
  return info
}

export async function listUpdateableGames(): Promise<string[]> {
  if (!HumbleUser.isLoggedIn()) return []
  const updates: string[] = []
  for (const [appName, installed] of installedGames.entries()) {
    const entry = cachedSubproducts.get(appName)
    if (!entry) continue
    const preferred = pickPreferredDownload(entry.subproduct)
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
  installStore.delete(appName)
  writeAllInstalled()
}

function writeAllInstalled() {
  if (!existsSync(humbleConfigPath)) {
    mkdirSync(humbleConfigPath, { recursive: true })
  }
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
    return
  }
  const installed = installedGames.get(appName)
  const game = library.get(appName)
  if (game && installed) {
    game.is_installed = true
    game.install = {
      install_path: installed.install_path,
      install_size: humanSize(installed.install_size),
      version: installed.version,
      platform: installed.platform as InstallPlatform,
      executable: installed.executable
    }
  }
}

export const getLaunchOptions = () => []

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function changeVersionPinnedStatus(_appName: string, _status: boolean) {
  logWarning(
    'changeVersionPinnedStatus not implemented for Humble',
    LogPrefix.Humble
  )
}
