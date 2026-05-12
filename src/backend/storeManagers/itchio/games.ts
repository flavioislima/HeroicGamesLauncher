/**
 * itch.io game manager. Each public function satisfies the `GameManager`
 * contract registered in `storeManagers/index.ts`. Real butlerd calls live
 * here; per-game library metadata comes from `./library`.
 */

import { existsSync } from 'graceful-fs'
import { join } from 'path'

import {
  ExecResult,
  ExtraInfo,
  GameInfo,
  GameSettings,
  InstallArgs,
  InstallPlatform,
  LaunchOption
} from 'common/types'
import { InstallResult, RemoveArgs } from 'common/types/game_manager'
import type LogWriter from 'backend/logger/log_writer'

import { LogPrefix, logError, logInfo, logWarning } from 'backend/logger'
import { GameConfig } from 'backend/game_config'
import { killPattern, shutdownWine } from 'backend/utils'
import { sendFrontendMessage } from '../../ipc'
import { launchGame } from 'backend/storeManagers/storeManagerCommon/games'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'

import { getClient } from './butlerd'
import { installStore } from './electronStores'
import {
  getGameInfo as getItchioLibraryGameInfo,
  getInstallInfo as getItchioLibraryInstallInfo,
  installState as setLibraryInstallState
} from './library'
import { ItchioInstallInfo, ItchioUpload } from 'common/types/itchio'

const NOT_IMPLEMENTED =
  'itch.io integration: butlerd command not yet implemented'

function logNotImplemented(operation: string, details: object): void {
  logWarning(
    [`${NOT_IMPLEMENTED} (operation=${operation})`, details],
    LogPrefix.Itchio
  )
}

interface InstallQueueResult {
  id: string
  installFolder: string
  stagingFolder: string
  caveId: string
}

interface ButlerdVerdictCandidate {
  path: string
  size?: number
  // butlerd flavor: 'linux'|'macos'|'windows'|'love'|'jar'|'html'|'script'|...
  flavor?: string
  arch?: string
}

interface ButlerdVerdict {
  basePath?: string
  candidates?: ButlerdVerdictCandidate[]
}

interface ButlerdCave {
  id: string
  game?: { id?: number }
  upload?: ItchioUpload
  installInfo?: {
    installFolder?: string
    installedSize?: number
    verdict?: ButlerdVerdict
  }
}

interface FetchCaveResult {
  cave?: ButlerdCave
}

interface ButlerdProgress {
  progress?: number
  eta?: number
  bps?: number
}

interface InstallLocation {
  id: string
  path: string
}

interface InstallLocationsListResult {
  installLocations: InstallLocation[]
}

interface InstallLocationsAddResult {
  installLocation: InstallLocation
}

/**
 * Translate butlerd's upload `platforms` map (lower-case `windows`/
 * `linux`/`osx`) into Heroic's mixed-case `InstallPlatform` values.
 * Picks whichever flag is set on the upload; falls back to the
 * requested platform if butlerd's payload doesn't say.
 */
function uploadInstalledPlatform(
  upload: ItchioUpload | undefined,
  requested: InstallPlatform
): InstallPlatform {
  if (upload?.platforms?.osx) return 'Mac'
  if (upload?.platforms?.linux) return 'linux'
  if (upload?.platforms?.windows) return 'Windows'
  return requested
}

/**
 * Pick the best launchable candidate from butlerd's verdict. Prefers
 * native-flavor candidates (a Mac install should run the macos
 * candidate, a Windows install should run the windows candidate); then
 * picks the largest binary, which is usually the main executable rather
 * than a redistributable or helper.
 */
function pickLaunchCandidate(
  verdict: ButlerdVerdict | undefined,
  platform: InstallPlatform
): ButlerdVerdictCandidate | undefined {
  const candidates = verdict?.candidates ?? []
  if (candidates.length === 0) return undefined
  const desiredFlavor =
    platform === 'Mac' ? 'macos' : platform === 'linux' ? 'linux' : 'windows'
  const native = candidates.filter((c) => c.flavor === desiredFlavor)
  const pool = native.length ? native : candidates
  return pool.slice().sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
}

/**
 * butlerd identifies install destinations by id, not by path. We register
 * the user-chosen parent directory as a butlerd "install location" on
 * first use and reuse the id afterwards. butlerd creates the per-game
 * subdirectory inside it.
 */
async function ensureInstallLocationId(path: string): Promise<string> {
  const client = await getClient()
  const list = await client.call<InstallLocationsListResult>(
    'Install.Locations.List'
  )
  const existing = list.installLocations?.find((loc) => loc.path === path)
  if (existing) return existing.id

  const added = await client.call<InstallLocationsAddResult>(
    'Install.Locations.Add',
    { path }
  )
  return added.installLocation.id
}

export async function getSettings(appName: string): Promise<GameSettings> {
  return (
    GameConfig.get(appName).config ||
    (await GameConfig.get(appName).getSettings())
  )
}

export function getGameInfo(appName: string): GameInfo {
  const info = getItchioLibraryGameInfo(appName)
  if (info) return info

  logError(
    [
      'Could not get game info for',
      `${appName},`,
      'returning empty object. itch.io support is not yet fully implemented.'
    ],
    LogPrefix.Itchio
  )
  return {
    app_name: '',
    runner: 'itchio',
    art_cover: '',
    art_square: '',
    install: {},
    is_installed: false,
    title: '',
    canRunOffline: false
  }
}

export function getExtraInfo(appName: string): Promise<ExtraInfo> {
  const game = getItchioLibraryGameInfo(appName)
  return Promise.resolve({
    about: {
      description: game?.description ?? '',
      shortDescription: game?.description ?? ''
    },
    reqs: [],
    releaseDate: undefined,
    storeUrl: game?.store_url,
    changelog: undefined
  })
}

export function importGame(
  appName: string,
  path: string,
  platform: InstallPlatform
): Promise<ExecResult> {
  logNotImplemented('importGame', { appName, path, platform })
  return Promise.resolve({ stdout: '', stderr: NOT_IMPLEMENTED })
}

export function onInstallOrUpdateOutput(
  appName: string,
  action: 'installing' | 'updating',
  data: string,
  totalDownloadSize: number
): void {
  // butlerd uses JSON-RPC notifications rather than stdout parsing, so this
  // intentionally just records a debug breadcrumb in case some upstream
  // helper drives it.
  logInfo(
    [
      `itch.io onInstallOrUpdateOutput passthrough (action=${action})`,
      { appName, dataLength: data.length, totalDownloadSize }
    ],
    LogPrefix.Itchio
  )
}

function emitProgress(appName: string, p: ButlerdProgress): void {
  if (p.progress === undefined) return
  sendFrontendMessage('progressUpdate', {
    appName,
    runner: 'itchio',
    status: 'installing',
    progress: {
      percent: Math.round(p.progress * 100),
      bytes: '',
      eta:
        p.eta !== undefined && Number.isFinite(p.eta)
          ? new Date(p.eta * 1000).toISOString().substring(11, 19)
          : '',
      downSpeed:
        p.bps !== undefined ? Math.round(p.bps / (1024 * 1024)) : undefined
    }
  })
}

export async function install(
  appName: string,
  { path, platformToInstall }: InstallArgs
): Promise<InstallResult> {
  const info = getItchioLibraryGameInfo(appName)
  if (!info) {
    return { status: 'error', error: `Unknown itch.io app ${appName}` }
  }

  const installInfo = (await getItchioLibraryInstallInfo(
    appName,
    platformToInstall
  )) as ItchioInstallInfo | undefined
  if (!installInfo) {
    return { status: 'error', error: 'no compatible upload found' }
  }

  try {
    const client = await getClient()
    const unsub = client.on('Progress', (params) =>
      emitProgress(appName, params as ButlerdProgress)
    )

    let queued: InstallQueueResult
    try {
      const installLocationId = await ensureInstallLocationId(path)
      queued = await client.call<InstallQueueResult>('Install.Queue', {
        game: installInfo.game,
        upload: installInfo.upload,
        installLocationId,
        reason: 'install'
      })

      await client.call('Install.Perform', {
        id: queued.id,
        stagingFolder: queued.stagingFolder
      })
    } finally {
      unsub()
    }

    installStore.set(appName, {
      ...installInfo,
      game: installInfo.game,
      upload: installInfo.upload
    })

    // Pull the canonical Cave record from butlerd: it tells us the real
    // upload (which may differ from the one we queued if butlerd resolved
    // a build), the resolved installFolder, and the detected launch
    // candidates (verdict).
    const caveResult = await client
      .call<FetchCaveResult>('Fetch.Cave', { caveId: queued.caveId })
      .catch((err: Error) => {
        logWarning(
          [
            'itch.io: Fetch.Cave after install failed (using queued values):',
            err.message
          ],
          LogPrefix.Itchio
        )
        return { cave: undefined } as FetchCaveResult
      })
    const cave = caveResult.cave
    const installFolder = cave?.installInfo?.installFolder ?? queued.installFolder
    const installedUpload = cave?.upload ?? installInfo.upload
    const installedPlatform = uploadInstalledPlatform(
      installedUpload,
      platformToInstall
    )
    const candidate = pickLaunchCandidate(
      cave?.installInfo?.verdict,
      installedPlatform
    )
    const executable = candidate
      ? join(installFolder, candidate.path)
      : ''
    if (!executable) {
      logWarning(
        `itch.io install ${appName}: butlerd verdict has no candidates; ` +
          'launch will require setting Target Executable in game settings.',
        LogPrefix.Itchio
      )
    }

    setLibraryInstallState(appName, true)

    const cachedInfo = getItchioLibraryGameInfo(appName)
    if (cachedInfo) {
      cachedInfo.install = {
        install_path: installFolder,
        install_size: String(installInfo.install_size),
        is_dlc: false,
        version: installedUpload?.channelName ?? '0',
        platform: installedPlatform,
        executable,
        appName
      }
      cachedInfo.is_installed = true
      cachedInfo.folder_name = installFolder
      // The caveId is the canonical butlerd handle for this install; stash
      // it on the in-memory GameInfo so uninstall/launch can reach it.
      ;(cachedInfo as GameInfo & { caveId?: string }).caveId = queued.caveId
    }

    sendFrontendMessage('refreshLibrary', 'itchio')
    return { status: 'done' }
  } catch (err) {
    logError(
      ['itch.io install failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { status: 'error', error: (err as Error).message }
  }
}

export function isNative(appName: string): boolean {
  // Mirror sideload: the install metadata's `platform` is the source of
  // truth once a game is installed. Windows builds always run natively on
  // win32 (incl. via Wine on non-Windows hosts, treated as "non-native"
  // here so launchGame goes through the wine prep path).
  const cached = getItchioLibraryGameInfo(appName)
  const platform = cached?.install?.platform
  if (!platform) return false
  if (isWindows) return true
  if (isMac && platform === 'Mac') return true
  if (isLinux && platform === 'linux') return true
  return false
}

export function addShortcuts(
  appName: string,
  fromMenu?: boolean
): Promise<void> {
  logNotImplemented('addShortcuts', { appName, fromMenu })
  return Promise.resolve()
}

export function removeShortcuts(appName: string): Promise<void> {
  logNotImplemented('removeShortcuts', { appName })
  return Promise.resolve()
}

/**
 * itch.io games are DRM-free, so we don't need butlerd's Launch RPC
 * (which insists on Windows prereq scaffolding and isn't a great fit
 * for the long tail of macOS/Linux indie titles). Instead, we treat
 * installed itch.io games like sideloaded ones: spawn the recorded
 * executable directly, going through Heroic's standard wine path on
 * non-Windows hosts for Windows builds.
 */
export async function launch(
  appName: string,
  logWriter: LogWriter,
  _launchArguments?: LaunchOption,
  args: string[] = []
): Promise<boolean> {
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached) {
    logError(
      `itch.io launch: unknown app ${appName}`,
      LogPrefix.Itchio
    )
    return false
  }
  if (!cached.install?.executable) {
    logError(
      `itch.io launch: ${appName} has no executable recorded. Set Target ` +
        'Executable in the game settings, or reinstall.',
      LogPrefix.Itchio
    )
    return false
  }
  return launchGame(appName, logWriter, cached, 'itchio', args)
}

export async function moveInstall(
  appName: string,
  newInstallPath: string
): Promise<InstallResult> {
  const cached = getItchioLibraryGameInfo(appName)
  const oldPath = cached?.install?.install_path
  if (!oldPath) {
    return { status: 'error', error: 'no current install path' }
  }
  // Delegate the filesystem move to whatever drove this call (the install
  // manager already does the cross-volume copy); we just record the new
  // location so future butlerd calls find the right cave.
  await import('./library').then((m) =>
    m.changeGameInstallPath(appName, newInstallPath)
  )
  logInfo(
    `itch.io moveInstall(${appName}): ${oldPath} -> ${newInstallPath}`,
    LogPrefix.Itchio
  )
  return { status: 'done' }
}

export async function repair(appName: string): Promise<ExecResult> {
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached?.is_installed) {
    return { stdout: '', stderr: `${appName} is not installed` }
  }
  // Repair == re-run Install.Perform against the same cave.
  const platform = (cached.install?.platform as InstallPlatform) ?? 'Windows'
  const result = await install(appName, {
    path: cached.install?.install_path ?? '',
    platformToInstall: platform
  })
  return {
    stdout: result.status,
    stderr: result.status === 'error' ? (result.error ?? '') : ''
  }
}

export function syncSaves(
  appName: string,
  arg: string,
  path: string
): Promise<string> {
  // itch.io has no first-party save sync; intentional no-op.
  logInfo(
    `itch.io syncSaves no-op (appName=${appName}, arg=${arg}, path=${path})`,
    LogPrefix.Itchio
  )
  return Promise.resolve('')
}

function getCaveId(appName: string): string | undefined {
  const cached = getItchioLibraryGameInfo(appName) as
    | (GameInfo & { caveId?: string })
    | undefined
  return cached?.caveId
}

export async function uninstall({
  appName,
  deleteFiles
}: RemoveArgs): Promise<ExecResult> {
  const caveId = getCaveId(appName)
  if (!caveId) {
    // Nothing to ask butlerd about; treat as a force-uninstall of stale local
    // state.
    await forceUninstall(appName)
    return { stdout: 'no cave', stderr: '' }
  }
  try {
    const client = await getClient()
    await client.call('Uninstall.Perform', {
      caveId,
      hard: deleteFiles ?? true
    })
    installStore.delete(appName)
    setLibraryInstallState(appName, false)
    sendFrontendMessage('refreshLibrary', 'itchio')
    return { stdout: 'done', stderr: '' }
  } catch (err) {
    logError(
      ['itch.io uninstall failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { stdout: '', stderr: (err as Error).message }
  }
}

export async function update(appName: string): Promise<InstallResult> {
  const caveId = getCaveId(appName)
  if (!caveId) {
    return { status: 'error', error: `no cave for ${appName}` }
  }
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached?.is_installed) {
    return { status: 'error', error: `${appName} is not installed` }
  }
  const platform = (cached.install?.platform as InstallPlatform) ?? 'Windows'

  const installInfo = (await getItchioLibraryInstallInfo(appName, platform)) as
    | ItchioInstallInfo
    | undefined
  if (!installInfo) {
    return { status: 'error', error: 'no compatible upload for update' }
  }

  try {
    const client = await getClient()
    const unsub = client.on('Progress', (params) =>
      emitProgress(appName, params as ButlerdProgress)
    )

    try {
      const queued = await client.call<InstallQueueResult>('Install.Queue', {
        caveId,
        game: installInfo.game,
        upload: installInfo.upload,
        reason: 'update'
      })
      await client.call('Install.Perform', {
        id: queued.id,
        stagingFolder: queued.stagingFolder
      })
    } finally {
      unsub()
    }

    installStore.set(appName, installInfo)
    sendFrontendMessage('refreshLibrary', 'itchio')
    return { status: 'done' }
  } catch (err) {
    logError(
      ['itch.io update failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { status: 'error', error: (err as Error).message }
  }
}

export async function forceUninstall(appName: string): Promise<void> {
  installStore.delete(appName)
  setLibraryInstallState(appName, false)
  sendFrontendMessage('refreshLibrary', 'itchio')
}

export async function stop(appName: string): Promise<void> {
  const cached = getItchioLibraryGameInfo(appName)
  const executable = cached?.install?.executable
  if (!executable) {
    logWarning(
      `itch.io stop(${appName}): no executable recorded, nothing to kill`,
      LogPrefix.Itchio
    )
    return
  }
  const exeName = executable.split('/').pop() ?? executable
  killPattern(exeName)
  if (!isNative(appName)) {
    const settings = await getSettings(appName)
    shutdownWine(settings)
  }
}

export async function isGameAvailable(appName: string): Promise<boolean> {
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached?.is_installed) return false
  const local = cached.install?.install_path
  if (local && existsSync(join(local))) return true

  const caveId = getCaveId(appName)
  if (!caveId) return false
  try {
    const client = await getClient()
    const result = await client.call<FetchCaveResult>('Fetch.Cave', {
      caveId
    })
    const installFolder = result.cave?.installInfo?.installFolder
    return Boolean(installFolder && existsSync(installFolder))
  } catch (err) {
    logWarning(
      ['itch.io isGameAvailable: Fetch.Cave failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return false
  }
}
