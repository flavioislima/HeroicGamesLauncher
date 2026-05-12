import { existsSync, readdirSync, statSync } from 'graceful-fs'
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

import {
  LogPrefix,
  createGameLogWriter,
  logError,
  logInfo,
  logWarning
} from 'backend/logger'
import { GameConfig } from 'backend/game_config'
import { killPattern, sendProgressUpdate, shutdownWine } from 'backend/utils'
import { sendFrontendMessage } from '../../ipc'
import { launchGame } from 'backend/storeManagers/storeManagerCommon/games'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'

import { getClient } from './butlerd'
import { installStore } from './electronStores'
import {
  butlerdPlatformKey,
  gameIdFromAppName,
  getGameInfo as getItchioLibraryGameInfo,
  getInstallInfo as getItchioLibraryInstallInfo,
  getStrictInstallInfo,
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

interface FetchCavesResult {
  items: ButlerdCave[]
  nextCursor?: string
}

// butlerd retains caves across Heroic restarts, so a previous uninstall
// from Heroic's UI may leave a cave behind that makes a fresh
// Install.Queue fail with "That upload is already installed!".
async function clearStaleCavesForGame(gameId: number): Promise<void> {
  const client = await getClient()
  try {
    const result = await client.call<FetchCavesResult>('Fetch.Caves', {
      filters: { gameId }
    })
    await Promise.all(
      (result.items ?? []).map(async (cave) => {
        try {
          await client.call('Uninstall.Perform', { caveId: cave.id, hard: true })
          logInfo(
            `itch.io: cleared stale cave ${cave.id} for game ${gameId}`,
            LogPrefix.Itchio
          )
        } catch (err) {
          logWarning(
            [
              `itch.io: failed to clear stale cave ${cave.id}:`,
              (err as Error).message
            ],
            LogPrefix.Itchio
          )
        }
      })
    )
  } catch (err) {
    logWarning(
      ['itch.io: Fetch.Caves failed:', (err as Error).message],
      LogPrefix.Itchio
    )
  }
}

// `.app` is a directory; spawn() needs the inner Mach-O at
// Contents/MacOS/<bin>. Returns the largest executable-bit file there
// (helpers are usually small).
function resolveAppBundleExecutable(
  appBundlePath: string
): { path: string; size: number } | undefined {
  const macOsDir = join(appBundlePath, 'Contents', 'MacOS')
  let entries: string[]
  try {
    entries = readdirSync(macOsDir)
  } catch {
    return undefined
  }
  let best: { path: string; size: number } | undefined
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(macOsDir, name)
    try {
      const s = statSync(full)
      if (!s.isFile() || (s.mode & 0o111) === 0) continue
      if (!best || s.size > best.size) best = { path: full, size: s.size }
    } catch {
      /* ignore */
    }
  }
  return best
}

// Walked only when butlerd's verdict is empty.
function scanForExecutable(
  folder: string,
  platform: InstallPlatform | string
): string | undefined {
  if (!folder || !existsSync(folder)) return undefined
  type Hit = { path: string; size: number }
  const hits: Hit[] = []
  const key = butlerdPlatformKey(platform)

  const walk = (dir: string, depth: number): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let s: ReturnType<typeof statSync>
      try {
        s = statSync(full)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        if (key === 'osx' && name.endsWith('.app')) {
          const inner = resolveAppBundleExecutable(full)
          if (inner) hits.push(inner)
          continue
        }
        if (depth < 4) walk(full, depth + 1)
        continue
      }
      if (key === 'windows' && name.toLowerCase().endsWith('.exe')) {
        if (/uninst|crash.?report|setup/i.test(name)) continue
        hits.push({ path: full, size: s.size })
      } else if (key === 'linux') {
        if (name.startsWith('.')) continue
        if ((s.mode & 0o111) !== 0) hits.push({ path: full, size: s.size })
      }
    }
  }

  walk(folder, 0)
  if (hits.length === 0) return undefined
  hits.sort((a, b) => b.size - a.size)
  return hits[0].path
}

// Lowercase, GOG-style: matches what `handleRunnersPlatforms` in
// `frontend/helpers/index.ts` produces, so install.platform round-trips
// cleanly through the frontend on later page opens.
const PLATFORM_BY_KEY: Record<'osx' | 'linux' | 'windows', InstallPlatform> = {
  osx: 'osx',
  linux: 'linux',
  windows: 'windows'
}

function uploadInstalledPlatform(
  upload: ItchioUpload | undefined,
  requested: InstallPlatform | string
): InstallPlatform {
  if (upload?.platforms?.osx) return PLATFORM_BY_KEY.osx
  if (upload?.platforms?.linux) return PLATFORM_BY_KEY.linux
  if (upload?.platforms?.windows) return PLATFORM_BY_KEY.windows
  return PLATFORM_BY_KEY[butlerdPlatformKey(requested) ?? 'windows']
}

const FLAVOR_BY_KEY: Record<'osx' | 'linux' | 'windows', string> = {
  osx: 'macos',
  linux: 'linux',
  windows: 'windows'
}

function pickLaunchCandidate(
  verdict: ButlerdVerdict | undefined,
  platform: InstallPlatform | string
): ButlerdVerdictCandidate | undefined {
  const candidates = verdict?.candidates ?? []
  if (candidates.length === 0) return undefined
  const desiredFlavor = FLAVOR_BY_KEY[butlerdPlatformKey(platform) ?? 'windows']
  const native = candidates.filter((c) => c.flavor === desiredFlavor)
  const pool = native.length ? native : candidates
  return pool.slice().sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
}

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

// butlerd uses JSON-RPC notifications, not stdout. This satisfies the
// GameManager contract; actual progress is wired via `createProgressEmitter`.
export function onInstallOrUpdateOutput(
  appName: string,
  action: 'installing' | 'updating',
  data: string,
  totalDownloadSize: number
): void {
  logInfo(
    [
      `itch.io onInstallOrUpdateOutput passthrough (action=${action})`,
      { appName, dataLength: data.length, totalDownloadSize }
    ],
    LogPrefix.Itchio
  )
}

// Per-call closure-bound progress emitter. butlerd fires Progress
// several times per second; throttle the log output (once per percent
// step or every 2s) so install.log stays readable. Frontend messages
// are not throttled — the progress bar can absorb the rate.
function createProgressEmitter(
  appName: string,
  action: 'installing' | 'updating',
  logWriter: LogWriter
) {
  let lastLoggedPercent = -1
  let lastLoggedAt = 0
  return (p: ButlerdProgress): void => {
    if (p.progress === undefined) return
    const percent = Math.round(p.progress * 100)
    const eta =
      p.eta !== undefined && Number.isFinite(p.eta)
        ? new Date(p.eta * 1000).toISOString().substring(11, 19)
        : ''
    const downSpeed =
      p.bps !== undefined ? Math.round(p.bps / (1024 * 1024)) : undefined

    sendProgressUpdate({
      appName,
      runner: 'itchio',
      status: action,
      progress: { percent, bytes: '', eta, downSpeed }
    })

    const now = Date.now()
    if (percent === lastLoggedPercent && now - lastLoggedAt < 2000) return
    lastLoggedPercent = percent
    lastLoggedAt = now
    const line = `Progress for ${appName}: ${percent}% ${
      eta ? `ETA ${eta}` : ''
    }${downSpeed !== undefined ? ` Down: ${downSpeed}MB/s` : ''}`.trim()
    logInfo(line, LogPrefix.Itchio)
    logWriter.logInfo(line).catch(() => {
      /* writer may be closed */
    })
  }
}

async function closeWriter(writer: LogWriter): Promise<void> {
  try {
    await writer.close()
  } catch {
    /* already closed */
  }
}

export async function install(
  appName: string,
  { path, platformToInstall }: InstallArgs
): Promise<InstallResult> {
  const info = getItchioLibraryGameInfo(appName)
  if (!info) {
    return { status: 'error', error: `Unknown itch.io app ${appName}` }
  }

  const installInfo = await getStrictInstallInfo(appName, platformToInstall)
  if (!installInfo) {
    return {
      status: 'error',
      error: `no ${platformToInstall} upload available for ${appName}`
    }
  }

  const installLogWriter = await createGameLogWriter(
    appName,
    'itchio',
    'install'
  )
  try {
    const headline = `Installing ${appName} (${platformToInstall})`
    logInfo(headline, LogPrefix.Itchio)
    installLogWriter.logInfo(headline)

    const client = await getClient()
    const onProgress = createProgressEmitter(
      appName,
      'installing',
      installLogWriter
    )
    const unsub = client.on('Progress', (params) =>
      onProgress(params as ButlerdProgress)
    )

    const numericGameId = gameIdFromAppName(appName)
    if (numericGameId !== undefined) await clearStaleCavesForGame(numericGameId)

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

    installStore.set(appName, installInfo)

    // Re-fetch the cave: butlerd may resolve to a different upload, and
    // the verdict/installFolder live there.
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
    const installFolder =
      cave?.installInfo?.installFolder ?? queued.installFolder
    const installedUpload = cave?.upload ?? installInfo.upload
    const installedPlatform = uploadInstalledPlatform(
      installedUpload,
      platformToInstall
    )
    const candidate = pickLaunchCandidate(
      cave?.installInfo?.verdict,
      installedPlatform
    )
    let executable = candidate ? join(installFolder, candidate.path) : ''
    if (
      executable &&
      butlerdPlatformKey(installedPlatform) === 'osx' &&
      executable.endsWith('.app')
    ) {
      executable = resolveAppBundleExecutable(executable)?.path ?? executable
    }
    if (!executable) {
      const scanned = scanForExecutable(installFolder, installedPlatform)
      if (scanned) {
        executable = scanned
        logInfo(
          `itch.io install ${appName}: executable picked by folder scan: ${scanned}`,
          LogPrefix.Itchio
        )
      } else {
        logWarning(
          `itch.io install ${appName}: butlerd verdict and folder scan ` +
            'both came up empty; set Target Executable in game settings.',
          LogPrefix.Itchio
        )
      }
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
      cachedInfo.caveId = queued.caveId
    }

    const updated = getItchioLibraryGameInfo(appName)
    if (updated) sendFrontendMessage('pushGameToLibrary', updated)
    return { status: 'done' }
  } catch (err) {
    logError(
      ['itch.io install failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { status: 'error', error: (err as Error).message }
  } finally {
    await closeWriter(installLogWriter)
  }
}

export function isNative(appName: string): boolean {
  const platform = getItchioLibraryGameInfo(appName)?.install?.platform
  if (!platform) return false
  if (isWindows) return true
  const key = butlerdPlatformKey(platform)
  if (isMac && key === 'osx') return true
  if (isLinux && key === 'linux') return true
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

// itch.io is DRM-free, so we skip butlerd's Launch RPC (which insists
// on Windows prereq scaffolding) and run the recorded executable directly,
// going through Heroic's wine path on non-Windows for Windows builds.
export async function launch(
  appName: string,
  logWriter: LogWriter,
  _launchArguments?: LaunchOption,
  args: string[] = []
): Promise<boolean> {
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached) {
    logError(`itch.io launch: unknown app ${appName}`, LogPrefix.Itchio)
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

// itch.io has no first-party save sync; intentional no-op.
export function syncSaves(
  appName: string,
  arg: string,
  path: string
): Promise<string> {
  logInfo(
    `itch.io syncSaves no-op (appName=${appName}, arg=${arg}, path=${path})`,
    LogPrefix.Itchio
  )
  return Promise.resolve('')
}

function getCaveId(appName: string): string | undefined {
  return getItchioLibraryGameInfo(appName)?.caveId
}

export async function uninstall({
  appName,
  deleteFiles
}: RemoveArgs): Promise<ExecResult> {
  const caveId = getCaveId(appName)
  if (!caveId) {
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
    const updated = getItchioLibraryGameInfo(appName)
    if (updated) sendFrontendMessage('pushGameToLibrary', updated)
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

  const updateLogWriter = await createGameLogWriter(
    appName,
    'itchio',
    'update'
  )
  try {
    const headline = `Updating ${appName} (${platform})`
    logInfo(headline, LogPrefix.Itchio)
    updateLogWriter.logInfo(headline)

    const client = await getClient()
    const onProgress = createProgressEmitter(
      appName,
      'updating',
      updateLogWriter
    )
    const unsub = client.on('Progress', (params) =>
      onProgress(params as ButlerdProgress)
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
    const updated = getItchioLibraryGameInfo(appName)
    if (updated) sendFrontendMessage('pushGameToLibrary', updated)
    return { status: 'done' }
  } catch (err) {
    logError(
      ['itch.io update failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { status: 'error', error: (err as Error).message }
  } finally {
    await closeWriter(updateLogWriter)
  }
}

export async function forceUninstall(appName: string): Promise<void> {
  installStore.delete(appName)
  setLibraryInstallState(appName, false)
  const updated = getItchioLibraryGameInfo(appName)
  if (updated) sendFrontendMessage('pushGameToLibrary', updated)
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
