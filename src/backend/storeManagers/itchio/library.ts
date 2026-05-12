/**
 * itch.io library manager. Wraps butlerd's Fetch.* methods to populate the
 * Heroic library. Owned games come from `Fetch.ProfileGames`; per-game upload
 * details (needed at install time) are pulled lazily via `Fetch.GameUploads`.
 */

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

import { LogPrefix, logDebug, logError, logInfo } from 'backend/logger'
import { isLinux } from 'backend/constants/environment'

import { getClient } from './butlerd'
import { configStore, installStore, libraryStore } from './electronStores'
import { ItchioUser } from './user'

/**
 * butlerd's `DownloadKey` wraps a single ownership record for a game the
 * user purchased, claimed, or was gifted. We only need the embedded
 * `game` for library display; the rest of the key metadata (createdAt,
 * downloads, etc.) is unused here.
 */
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

const inMemoryLibrary: Map<string, GameInfo> = new Map()

function gameToAppName(game: ItchioGame): string {
  return `itchio-${game.id}`
}

function gameToGameInfo(game: ItchioGame): GameInfo {
  const cover = game.coverUrl ?? game.stillCoverUrl ?? ''
  const platforms = game.platforms ?? {}
  // The InstallModal reads `is_mac_native` / `is_linux_native` off
  // GameInfo to decide which platform radio buttons to render. itch.io
  // wraps that in `Game.platforms`. Per project decision: on Linux we
  // deliberately suppress the native-Linux option so users always go
  // through the Wine path (uploads vary too much in shape for
  // reliable native launching right now).
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

  // Fetch.ProfileOwnedKeys returns the download keys the profile owns —
  // i.e. games the user bought, claimed for free, or was gifted. (The
  // sibling Fetch.ProfileGames returns games the profile *uploaded* as
  // a developer, which is almost always empty for players.)
  do {
    const result = await client.call<FetchProfileOwnedKeysResult>(
      'Fetch.ProfileOwnedKeys',
      {
        profileId,
        cursor,
        // Force a network refresh on the first page; subsequent pages
        // honour butlerd's own cache.
        fresh: pages === 0
      }
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
  // Preserve install metadata for games we already have installed locally.
  for (const game of persisted) {
    const existing = inMemoryLibrary.get(game.app_name)
    if (existing?.is_installed) {
      game.install = existing.install
      game.is_installed = true
      game.folder_name = existing.folder_name
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

export function getGameInfo(appName: string): GameInfo | undefined {
  return inMemoryLibrary.get(appName)
}

// Map Heroic's InstallPlatform values to butlerd's platform keys.
// Heroic's frontend runs values through `handleRunnersPlatforms` before they
// reach non-legendary backends, so we may receive either Heroic's display
// values ('Mac', 'Windows') or the runner-normalised ones ('osx', 'windows').
function butlerdPlatformKey(
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

/**
 * `strict` mode: only return an upload that explicitly advertises the
 * requested platform. Used by the install path so the user's platform
 * choice in the InstallModal is honoured exactly.
 *
 * Lenient mode (default): fall back to the largest upload so cosmetic
 * callers like the GamePage's preflight `getInstallInfo` can render
 * size/metadata even when no upload matches the host platform.
 */
function pickUploadForPlatform(
  uploads: ItchioUpload[],
  platform: InstallPlatform,
  strict = false
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

async function fetchUploadsAndPick(
  appName: string,
  installPlatform: InstallPlatform,
  strict: boolean
): Promise<{ info: GameInfo; gameId: number; upload: ItchioUpload } | undefined> {
  const info = inMemoryLibrary.get(appName)
  if (!info) {
    logError(`itch.io getInstallInfo: unknown app ${appName}`, LogPrefix.Itchio)
    return undefined
  }
  const gameId = Number(appName.replace(/^itchio-/, ''))
  if (Number.isNaN(gameId)) return undefined

  const client = await getClient()
  const profileId = configStore.get_nodefault('profileId')
  // `compatible: true` filters out uploads butlerd considers
  // incompatible with the host (e.g. windows uploads on macOS), which
  // is the opposite of what Heroic wants — users explicitly choose
  // Windows-via-Wine on Mac and Linux. Always fetch the full upload
  // list and let `pickUploadForPlatform` honour the user's pick.
  const result = await client.call<FetchGameUploadsResult>(
    'Fetch.GameUploads',
    { gameId, profileId, fresh: true }
  )
  const upload = pickUploadForPlatform(
    result.uploads ?? [],
    installPlatform,
    strict
  )
  if (!upload) return undefined
  return { info, gameId, upload }
}

function buildInstallInfo(
  info: GameInfo,
  gameId: number,
  upload: ItchioUpload
): ItchioInstallInfo {
  return {
    game: { ...info, id: gameId, owned_dlc: [] } as unknown as ItchioGame,
    upload,
    install_size: upload.size,
    download_size: upload.size,
    launch_options: [],
    manifest: {
      disk_size: upload.size,
      download_size: upload.size
    }
  }
}

export async function getInstallInfo(
  appName: string,
  installPlatform: InstallPlatform
): Promise<InstallInfo | undefined> {
  try {
    const picked = await fetchUploadsAndPick(appName, installPlatform, false)
    if (!picked) {
      logError(
        `itch.io: no uploads available for ${appName} on ${installPlatform}`,
        LogPrefix.Itchio
      )
      return undefined
    }
    const installInfo = buildInstallInfo(picked.info, picked.gameId, picked.upload)
    installStore.set(appName, installInfo)
    return installInfo as unknown as InstallInfo
  } catch (err) {
    logError(
      ['itch.io getInstallInfo failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return undefined
  }
}

/**
 * Strict variant for the install path: returns undefined if no upload
 * matches the requested platform exactly. Prevents the install from
 * silently grabbing a different OS's build when the user picked
 * Windows-on-Mac on a game without a Windows upload.
 */
export async function getStrictInstallInfo(
  appName: string,
  installPlatform: InstallPlatform
): Promise<ItchioInstallInfo | undefined> {
  try {
    const picked = await fetchUploadsAndPick(appName, installPlatform, true)
    if (!picked) return undefined
    return buildInstallInfo(picked.info, picked.gameId, picked.upload)
  } catch (err) {
    logError(
      ['itch.io getStrictInstallInfo failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return undefined
  }
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
  const caveByApp = new Map<string, string>()
  for (const game of inMemoryLibrary.values()) {
    const caveId = (game as GameInfo & { caveId?: string }).caveId
    if (game.is_installed && caveId) caveByApp.set(game.app_name, caveId)
  }
  if (caveByApp.size === 0) return []

  try {
    const client = await getClient()
    const result = await client.call<CheckUpdateResult>('CheckUpdate', {
      caveIds: Array.from(caveByApp.values()),
      verbose: false
    })
    const updates: string[] = []
    for (const update of result.updates ?? []) {
      for (const [appName, caveId] of caveByApp) {
        if (caveId === update.caveId) {
          updates.push(appName)
          break
        }
      }
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
  // itch.io doesn't expose per-build pinning; no-op.
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
