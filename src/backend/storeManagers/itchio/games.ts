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
import { sendGameStatusUpdate } from 'backend/utils'
import { sendFrontendMessage } from '../../ipc'

import { getClient } from './butlerd'
import { installStore } from './electronStores'
import {
  getGameInfo as getItchioLibraryGameInfo,
  getInstallInfo as getItchioLibraryInstallInfo,
  installState as setLibraryInstallState
} from './library'
import { ItchioInstallInfo } from 'common/types/itchio'

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
  install_folder: string
  staging_folder: string
  cave_id: string
}

interface ButlerdCave {
  id: string
  game_id: number
  install_folder: string
  installed_size: number
  channel_name?: string
}

interface FetchCaveResult {
  cave?: ButlerdCave
}

interface ButlerdProgress {
  progress?: number
  eta?: number
  bps?: number
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
    platformToInstall,
    {}
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
      queued = await client.call<InstallQueueResult>('Install.Queue', {
        game: installInfo.game,
        upload: installInfo.upload,
        install_folder: path,
        reason: 'install'
      })

      await client.call('Install.Perform', {
        id: queued.id,
        staging_folder: queued.staging_folder
      })
    } finally {
      unsub()
    }

    installStore.set(appName, {
      ...installInfo,
      // overwrite install_folder with butlerd's resolved value
      game: installInfo.game,
      upload: installInfo.upload
    })

    setLibraryInstallState(appName, true)

    const cachedInfo = getItchioLibraryGameInfo(appName)
    if (cachedInfo) {
      cachedInfo.install = {
        install_path: queued.install_folder,
        install_size: String(installInfo.install_size),
        is_dlc: false,
        version: installInfo.upload.channel_name ?? '0',
        platform: platformToInstall,
        executable: '',
        appName
      }
      cachedInfo.is_installed = true
      cachedInfo.folder_name = queued.install_folder
      // The cave_id is the canonical butlerd handle for this install; stash
      // it on `install` via the underlying record so uninstall/launch can
      // reach it.
      ;(cachedInfo as GameInfo & { cave_id?: string }).cave_id = queued.cave_id
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
  const cached = installStore.get(appName)
  if (!cached) return false
  // Linux + macOS uploads run natively; Windows uploads need wine.
  return Boolean(
    cached.upload.platforms.linux || cached.upload.platforms.osx
  )
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

interface ManifestAction {
  name: string
  path?: string
  args?: string[]
}

interface PickManifestActionParams {
  actions: ManifestAction[]
}

interface PrereqsParams {
  tasks?: unknown
}

interface AcceptLicenseParams {
  text?: string
}

interface LaunchRunningParams {
  pid?: number
}

const runningPidByApp = new Map<string, number>()

export async function launch(
  appName: string,
  logWriter: LogWriter,
  launchArguments?: LaunchOption,
  _args?: string[],
  _skipVersionCheck?: boolean
): Promise<boolean> {
  const caveId = getCaveId(appName)
  if (!caveId) {
    logError(
      `itch.io launch: ${appName} has no cave_id; is it installed?`,
      LogPrefix.Itchio
    )
    return false
  }

  const cached = getItchioLibraryGameInfo(appName)
  logWriter.writeString(
    `[itchio] launching ${cached?.title ?? appName} (cave=${caveId})\n`
  )

  const client = await getClient()

  // butlerd may call back asking the client to pick an action, accept a
  // license, or acknowledge prereq results. Default to picking the first
  // option / accepting / continuing — typical for the long tail of itch.io
  // games that ship a single executable.
  const requestedActionName =
    launchArguments && 'name' in launchArguments
      ? launchArguments.name
      : undefined
  const unsubPick = client.handle(
    'PickManifestAction',
    (params: unknown) => {
      const { actions } = (params ?? {}) as PickManifestActionParams
      if (requestedActionName && actions?.length) {
        const idx = actions.findIndex((a) => a.name === requestedActionName)
        if (idx >= 0) return { index: idx }
      }
      return { index: 0 }
    }
  )
  const unsubLicense = client.handle(
    'AcceptLicense',
    (_params: unknown) => {
      logInfo(`itch.io: auto-accepting license for ${appName}`, LogPrefix.Itchio)
      return { accept: true }
    }
  )
  const unsubPrereqs = client.handle('PrereqsFailed', (_params: unknown) => ({
    continue: true
  }))
  const unsubAllowSandboxSetup = client.handle(
    'AllowSandboxSetup',
    () => ({ allow: true })
  )

  const unsubRunning = client.on('LaunchRunning', (params: unknown) => {
    const { pid } = (params ?? {}) as LaunchRunningParams
    if (pid) runningPidByApp.set(appName, pid)
    sendGameStatusUpdate({ appName, runner: 'itchio', status: 'playing' })
  })
  const unsubExited = client.on('LaunchExited', () => {
    runningPidByApp.delete(appName)
    sendGameStatusUpdate({ appName, runner: 'itchio', status: 'done' })
  })

  sendGameStatusUpdate({ appName, runner: 'itchio', status: 'playing' })

  try {
    await client.call('Launch', { cave_id: caveId })
    logWriter.writeString('[itchio] launch finished\n')
    return true
  } catch (err) {
    logError(
      ['itch.io launch failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    logWriter.writeString(`[itchio] launch error: ${(err as Error).message}\n`)
    sendGameStatusUpdate({ appName, runner: 'itchio', status: 'done' })
    return false
  } finally {
    unsubPick()
    unsubLicense()
    unsubPrereqs()
    unsubAllowSandboxSetup()
    unsubRunning()
    unsubExited()
    runningPidByApp.delete(appName)
  }
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
  const platform =
    (cached.install?.platform as InstallPlatform) ?? 'Windows'
  const result = await install(appName, {
    path: cached.install?.install_path ?? '',
    platformToInstall: platform
  })
  return {
    stdout: result.status,
    stderr: result.status === 'error' ? result.error ?? '' : ''
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
    | (GameInfo & { cave_id?: string })
    | undefined
  return cached?.cave_id
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
      cave_id: caveId,
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
  logNotImplemented('update', { appName })
  return { status: 'error', error: NOT_IMPLEMENTED }
}

export async function forceUninstall(appName: string): Promise<void> {
  installStore.delete(appName)
  setLibraryInstallState(appName, false)
  sendFrontendMessage('refreshLibrary', 'itchio')
}

export async function stop(
  appName: string,
  _stopWine?: boolean
): Promise<void> {
  const pid = runningPidByApp.get(appName)
  if (!pid) {
    logWarning(
      `itch.io stop(${appName}): no running pid tracked`,
      LogPrefix.Itchio
    )
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    logWarning(
      [`itch.io stop(${appName}) SIGTERM failed:`, (err as Error).message],
      LogPrefix.Itchio
    )
  }
  runningPidByApp.delete(appName)
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
      cave_id: caveId
    })
    return Boolean(result.cave && existsSync(result.cave.install_folder))
  } catch (err) {
    logWarning(
      ['itch.io isGameAvailable: Fetch.Cave failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return false
  }
}
