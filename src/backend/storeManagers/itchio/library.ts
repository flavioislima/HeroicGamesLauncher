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

import { getClient } from './butlerd'
import { configStore, installStore, libraryStore } from './electronStores'
import { ItchioUser } from './user'

interface ProfileGameRecord {
  game: ItchioGame
}

interface FetchProfileGamesResult {
  items: ProfileGameRecord[]
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

function platformFromUpload(upload: ItchioUpload): InstallPlatform {
  if (upload.platforms.linux) return 'linux'
  if (upload.platforms.osx) return 'Mac'
  if (upload.platforms.windows) return 'Windows'
  return 'Windows'
}

function gameToGameInfo(game: ItchioGame): GameInfo {
  const cover = game.cover_url ?? game.still_cover_url ?? ''
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
    developer: game.user?.display_name || game.user?.username,
    description: game.short_text
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

  do {
    const result = await client.call<FetchProfileGamesResult>(
      'Fetch.ProfileGames',
      {
        profile_id: profileId,
        cursor,
        // Force a network refresh on the first page; subsequent pages
        // honour butlerd's own cache.
        fresh: pages === 0
      }
    )
    for (const item of result.items) {
      games.push(item.game)
    }
    cursor = result.nextCursor
    pages += 1
    if (pages > 50) {
      logError(
        'itch.io Fetch.ProfileGames bailed out after 50 pages',
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

function pickUploadForPlatform(
  uploads: ItchioUpload[],
  platform: InstallPlatform
): ItchioUpload | undefined {
  const key: keyof ItchioUpload['platforms'] | undefined =
    platform === 'linux'
      ? 'linux'
      : platform === 'Mac'
        ? 'osx'
        : platform === 'Windows'
          ? 'windows'
          : undefined
  if (!key) return uploads[0]
  return (
    uploads.find((u) => u.platforms[key]) ??
    // Fall back to the largest upload — usually the OS-native one.
    uploads.slice().sort((a, b) => b.size - a.size)[0]
  )
}

export async function getInstallInfo(
  appName: string,
  installPlatform: InstallPlatform,
  _options: { branch?: string; build?: string; lang?: string; retries?: number }
): Promise<InstallInfo | undefined> {
  const info = inMemoryLibrary.get(appName)
  if (!info) {
    logError(`itch.io getInstallInfo: unknown app ${appName}`, LogPrefix.Itchio)
    return undefined
  }
  const gameId = Number(appName.replace(/^itchio-/, ''))
  if (Number.isNaN(gameId)) return undefined

  try {
    const client = await getClient()
    const profileId = configStore.get_nodefault('profileId')
    const result = await client.call<FetchGameUploadsResult>(
      'Fetch.GameUploads',
      { game_id: gameId, profile_id: profileId, compatible: true, fresh: true }
    )
    const upload = pickUploadForPlatform(result.uploads, installPlatform)
    if (!upload) {
      logError(
        `itch.io: no compatible upload for ${appName} on ${installPlatform}`,
        LogPrefix.Itchio
      )
      return undefined
    }
    const installInfo: ItchioInstallInfo = {
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

export function listUpdateableGames(): Promise<string[]> {
  // Update detection lands in the dedicated update commit.
  return Promise.resolve([])
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
