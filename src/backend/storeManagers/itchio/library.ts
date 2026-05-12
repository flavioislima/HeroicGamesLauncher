import {
  ExecResult,
  GameInfo,
  InstallInfo,
  InstallPlatform,
  LaunchOption
} from 'common/types'
import {
  ItchioGame,
  ItchioInstallInfo,
  ItchioUpload
} from 'common/types/itchio'
import { ItchioGameInfo } from './types'

import { LogPrefix, logDebug, logError, logInfo } from 'backend/logger'
import { isLinux } from 'backend/constants/environment'

import { getClient } from './butlerd'
import { configStore, installStore, libraryStore } from './electronStores'
import { ItchioUser } from './user'

interface DownloadKeyRecord {
  id: number
  gameId: number
  game: ItchioGame
}

interface FetchProfileOwnedKeysResult {
  items: DownloadKeyRecord[]
  stale?: boolean
  nextCursor?: string
}

interface FetchGameUploadsResult {
  uploads: ItchioUpload[]
}

const inMemoryLibrary: Map<string, ItchioGameInfo> = new Map()

function gameToAppName(game: ItchioGame): string {
  return `itchio-${game.id}`
}

export function gameIdFromAppName(appName: string): number | undefined {
  const id = Number(appName.replace(/^itchio-/, ''))
  return Number.isNaN(id) ? undefined : id
}

function gameToGameInfo(game: ItchioGame): ItchioGameInfo {
  const cover = game.coverUrl ?? game.stillCoverUrl ?? ''
  const platforms = game.platforms ?? {}
  // On Linux we suppress native-Linux: uploads vary too much in shape
  // for reliable native launching, so we always route through Wine.
  const is_mac_native = Boolean(platforms.osx)
  const is_linux_native = isLinux ? false : Boolean(platforms.linux)
  return {
    app_name: gameToAppName(game),
    runner: 'itchio',
    title: game.title,
    art_cover: cover,
    art_square: cover,
    install: {},
    is_installed: false,
    canRunOffline: true,
    store_url: game.url,
    developer: game.user?.displayName || game.user?.username,
    description: game.shortText,
    is_mac_native,
    is_linux_native
  }
}

function loadFromCache(): GameInfo[] {
  const cached = libraryStore.get('library', [])
  for (const g of cached) inMemoryLibrary.set(g.app_name, g)
  return cached
}

export async function initItchioLibraryManager(): Promise<void> {
  loadFromCache()
  if (!ItchioUser.isLoggedIn()) {
    logDebug(
      'itch.io: not logged in, skipping initial refresh',
      LogPrefix.Itchio
    )
    return
  }
  try {
    await refresh()
  } catch (err) {
    logError(
      ['itch.io initial library refresh failed:', (err as Error).message],
      LogPrefix.Itchio
    )
  }
}

export async function refresh(): Promise<ExecResult | null> {
  const profileId = configStore.get_nodefault('profileId')
  if (profileId === undefined) {
    logInfo(
      'itch.io refresh skipped: no profile id (not logged in)',
      LogPrefix.Itchio
    )
    return null
  }

  const client = await getClient()
  const games: ItchioGame[] = []
  let cursor: string | undefined
  let pages = 0

  // Fetch.ProfileOwnedKeys = games bought / claimed / gifted (NOT
  // Fetch.ProfileGames, which is developer-uploaded titles).
  do {
    const result = await client.call<FetchProfileOwnedKeysResult>(
      'Fetch.ProfileOwnedKeys',
      { profileId, cursor, fresh: pages === 0 }
    )
    for (const item of result.items ?? []) {
      if (item.game) games.push(item.game)
    }
    cursor = result.nextCursor
    pages += 1
    if (pages > 50) {
      logError(
        'itch.io Fetch.ProfileOwnedKeys bailed out after 50 pages',
        LogPrefix.Itchio
      )
      break
    }
  } while (cursor)

  const persisted = games.map(gameToGameInfo)
  for (const game of persisted) {
    const existing = inMemoryLibrary.get(game.app_name)
    if (existing?.is_installed) {
      game.install = existing.install
      game.is_installed = true
      game.folder_name = existing.folder_name
      game.caveId = existing.caveId
    }
    inMemoryLibrary.set(game.app_name, game)
  }
  libraryStore.set('library', persisted)
  logInfo(
    `itch.io library refreshed: ${persisted.length} games`,
    LogPrefix.Itchio
  )
  return { stdout: '', stderr: '' }
}

export function getGameInfo(appName: string): ItchioGameInfo | undefined {
  return inMemoryLibrary.get(appName)
}

// Heroic's frontend runs values through `handleRunnersPlatforms` before they
// reach non-legendary backends, so we may receive either Heroic's display
// values ('Mac', 'Windows') or the runner-normalised ones ('osx', 'windows').
export function butlerdPlatformKey(
  platform: InstallPlatform | string
): 'windows' | 'linux' | 'osx' | undefined {
  switch (platform) {
    case 'Mac':
    case 'osx':
      return 'osx'
    case 'linux':
      return 'linux'
    case 'Windows':
    case 'windows':
      return 'windows'
    default:
      return undefined
  }
}

function pickUploadForPlatform(
  uploads: ItchioUpload[],
  platform: InstallPlatform,
  strict: boolean
): ItchioUpload | undefined {
  if (uploads.length === 0) return undefined
  const key = butlerdPlatformKey(platform)
  if (key) {
    const matching = uploads.filter((u) => Boolean(u.platforms?.[key]))
    if (matching.length > 0) {
      return matching.slice().sort((a, b) => b.size - a.size)[0]
    }
  }
  if (strict) return undefined
  return uploads.slice().sort((a, b) => b.size - a.size)[0]
}

async function fetchInstallInfo(
  appName: string,
  installPlatform: InstallPlatform,
  strict: boolean
): Promise<ItchioInstallInfo | undefined> {
  const info = inMemoryLibrary.get(appName)
  if (!info) {
    logError(`itch.io getInstallInfo: unknown app ${appName}`, LogPrefix.Itchio)
    return undefined
  }
  const gameId = gameIdFromAppName(appName)
  if (gameId === undefined) return undefined

  try {
    const client = await getClient()
    const profileId = configStore.get_nodefault('profileId')
    // `compatible: true` would drop windows uploads on macOS/linux —
    // exactly what Heroic offers via Wine — so always fetch the full list.
    const result = await client.call<FetchGameUploadsResult>(
      'Fetch.GameUploads',
      { gameId, profileId, fresh: true }
    )
    const upload = pickUploadForPlatform(
      result.uploads ?? [],
      installPlatform,
      strict
    )
    if (!upload) {
      if (!strict) {
        logError(
          `itch.io: no uploads available for ${appName} on ${installPlatform}`,
          LogPrefix.Itchio
        )
      }
      return undefined
    }
    return {
      game: { ...info, id: gameId, owned_dlc: [] } as unknown as ItchioGame,
      upload,
      install_size: upload.size,
      download_size: upload.size,
      launch_options: [],
      manifest: { disk_size: upload.size, download_size: upload.size }
    }
  } catch (err) {
    logError(
      ['itch.io getInstallInfo failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return undefined
  }
}

// Lenient: falls back to the largest upload so the GamePage preflight
// call can render size/metadata even when no upload matches the host
// platform. Must satisfy the LibraryManager contract — third arg is
// fixed by Heroic, not customisable here.
export async function getInstallInfo(
  appName: string,
  installPlatform: InstallPlatform
): Promise<InstallInfo | undefined> {
  const installInfo = await fetchInstallInfo(appName, installPlatform, false)
  if (installInfo) installStore.set(appName, installInfo)
  return installInfo as unknown as InstallInfo | undefined
}

// Strict: only returns an upload that advertises the requested platform.
// Used by `install()` so the user's platform choice is honoured exactly.
export function getStrictInstallInfo(
  appName: string,
  installPlatform: InstallPlatform
): Promise<ItchioInstallInfo | undefined> {
  return fetchInstallInfo(appName, installPlatform, true)
}

interface CheckUpdateGameUpdate {
  caveId: string
  game?: { id?: number }
}

interface CheckUpdateResult {
  updates: CheckUpdateGameUpdate[]
  warnings?: string[]
}

export async function listUpdateableGames(): Promise<string[]> {
  if (!ItchioUser.isLoggedIn()) return []
  const appByCave = new Map<string, string>()
  for (const game of inMemoryLibrary.values()) {
    if (game.is_installed && game.caveId) appByCave.set(game.caveId, game.app_name)
  }
  if (appByCave.size === 0) return []

  try {
    const client = await getClient()
    const result = await client.call<CheckUpdateResult>('CheckUpdate', {
      caveIds: Array.from(appByCave.keys()),
      verbose: false
    })
    const updates: string[] = []
    for (const update of result.updates ?? []) {
      const appName = appByCave.get(update.caveId)
      if (appName) updates.push(appName)
    }
    return updates
  } catch (err) {
    logError(
      ['itch.io CheckUpdate failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return []
  }
}

export function changeGameInstallPath(
  appName: string,
  newPath: string
): Promise<void> {
  const info = inMemoryLibrary.get(appName)
  if (info?.install) {
    info.install.install_path = newPath
    libraryStore.set('library', Array.from(inMemoryLibrary.values()))
  }
  return Promise.resolve()
}

export function changeVersionPinnedStatus(
  appName: string,
  status: boolean
): void {
  logDebug(
    `itch.io changeVersionPinnedStatus(${appName}, ${status}) is a no-op`,
    LogPrefix.Itchio
  )
}

export function installState(appName: string, state: boolean): void {
  const info = inMemoryLibrary.get(appName)
  if (!info) return
  info.is_installed = state
  if (!state) info.install = {}
  inMemoryLibrary.set(appName, info)
  libraryStore.set('library', Array.from(inMemoryLibrary.values()))
}

export function getLaunchOptions(appName: string): LaunchOption[] {
  const cached = installStore.get(appName)
  return cached?.launch_options ?? []
}
