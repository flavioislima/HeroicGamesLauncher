import {
  ExecResult,
  ExtraInfo,
  GameInfo,
  GameSettings,
  InstallArgs,
  LaunchOption
} from 'common/types'
import { InstallResult, RemoveArgs } from 'common/types/game_manager'
import {
  changeGameInstallPath as humbleChangeInstallPath,
  getCachedSubproduct,
  getGameInfo as humbleGetGameInfo,
  getInstallInfo,
  getInstalled,
  installState,
  persistInstalled,
  refreshInstalled,
  removeInstalled
} from './library'
import {
  LogPrefix,
  logError,
  logInfo,
  logWarning,
  createGameLogWriter
} from 'backend/logger'
import { GameConfig } from 'backend/game_config'
import {
  getKnownFixesEnvVariables,
  launchCleanup,
  prepareLaunch,
  prepareWineLaunch,
  setupEnvVars,
  setupWrapperEnvVars,
  setupWrappers
} from 'backend/launcher'
import { existsSync } from 'graceful-fs'
import { rm } from 'fs/promises'
import { spawn } from 'child_process'
import { showDialogBoxModalAuto } from 'backend/dialog/dialog'
import { t } from 'i18next'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'
import { getWineFlagsArray } from 'backend/utils/compatibility_layers'
import shlex from 'shlex'
import {
  killPattern,
  moveOnUnix,
  moveOnWindows,
  sendGameStatusUpdate,
  sendProgressUpdate,
  shutdownWine
} from 'backend/utils'
import {
  addShortcuts as addShortcutsUtil,
  removeShortcuts as removeShortcutsUtil
} from '../../shortcuts/shortcuts/shortcuts'
import { removeNonSteamGame } from 'backend/shortcuts/nonesteamgame/nonesteamgame'
import { sendFrontendMessage } from '../../ipc'
import { join } from 'path'
import { downloadToTempFile, runInstaller } from './installers'
import { HumbleInstallPlatform, HumbleInstalledInfo } from 'common/types/humble'

import type LogWriter from 'backend/logger/log_writer'

export async function getSettings(appName: string): Promise<GameSettings> {
  const gameConfig = GameConfig.get(appName)
  return gameConfig.config || (await gameConfig.getSettings())
}

export function getGameInfo(appName: string): GameInfo {
  const info = humbleGetGameInfo(appName)
  if (!info) {
    logError(['Could not get Humble game info for', appName], LogPrefix.Humble)
    return {
      app_name: appName,
      runner: 'humble',
      art_cover: '',
      art_square: '',
      install: {},
      is_installed: false,
      title: appName,
      canRunOffline: true
    }
  }
  return info
}

export async function getExtraInfo(appName: string): Promise<ExtraInfo> {
  const info = humbleGetGameInfo(appName)
  return {
    reqs: [],
    about: info?.description
      ? {
          description: info.description,
          shortDescription: info.description
        }
      : undefined,
    releaseDate: info?.extra?.releaseDate
  }
}

export async function importGame(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _appName: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _path: string
): Promise<ExecResult> {
  // Importing existing Humble installs is not supported in v1; users can
  // re-install through the launcher instead.
  return { stdout: '', stderr: 'Importing Humble games is not supported yet' }
}

export function onInstallOrUpdateOutput(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _appName: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _action: 'installing' | 'updating',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _data: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _totalDownloadSize = -1
) {
  // Humble's installer is run in-process; progress is dispatched directly
  // from `runDownload` via `sendProgressUpdate`. This stub satisfies the
  // GameManager interface.
}

const abortControllers = new Map<string, AbortController>()

async function runDownloadAndInstall(
  appName: string,
  installPath: string,
  action: 'installing' | 'updating'
): Promise<InstallResult> {
  const entry = getCachedSubproduct(appName)
  if (!entry) {
    return {
      status: 'error',
      error: `Humble subproduct ${appName} not found in cached library`
    }
  }
  const installInfo = await getInstallInfo(appName)
  if (!installInfo) {
    return {
      status: 'error',
      error: `Could not resolve Humble download URL for ${appName}`
    }
  }

  const abort = new AbortController()
  abortControllers.set(appName, abort)
  const gameSettings = await getSettings(appName)

  try {
    sendGameStatusUpdate({
      appName,
      runner: 'humble',
      status: action,
      folder: installPath
    })

    const tempFile = await downloadToTempFile(
      installInfo.manifest.download_url,
      installInfo.manifest.md5,
      abort.signal,
      ({ percent, bytesDownloaded, totalBytes, speedBytesPerSecond }) => {
        sendProgressUpdate({
          appName,
          runner: 'humble',
          status: action,
          progress: {
            percent,
            bytes: humanBytes(bytesDownloaded),
            eta: estimateEta(bytesDownloaded, totalBytes, speedBytesPerSecond),
            downSpeed: speedBytesPerSecond / (1024 * 1024)
          }
        })
      }
    )

    const { executable } = await runInstaller({
      appName,
      archivePath: tempFile,
      installPath,
      gameSettings
    })

    const installed: HumbleInstalledInfo = {
      app_name: appName,
      gamekey: entry.order.gamekey,
      subproduct_machine_name: entry.subproduct.machine_name,
      install_path: installPath,
      platform: installInfo.game.platform,
      executable,
      md5: installInfo.manifest.md5,
      version: installInfo.game.version,
      install_size: installInfo.manifest.disk_size
    }
    persistInstalled(installed)
    installState(appName, true)

    sendGameStatusUpdate({
      appName,
      runner: 'humble',
      status: 'done'
    })

    return { status: 'done' }
  } catch (error) {
    if (abort.signal.aborted) {
      return { status: 'abort' }
    }
    logError(
      [`Failed to ${action.replace('ing', '')} ${appName}:`, error],
      LogPrefix.Humble
    )
    return { status: 'error', error: `${error}` }
  } finally {
    abortControllers.delete(appName)
  }
}

export async function install(
  appName: string,
  { path }: InstallArgs
): Promise<InstallResult> {
  const installLogWriter = await createGameLogWriter(
    appName,
    'humble',
    'install'
  )
  installLogWriter.logInfo(`Installing ${appName} to ${path}`)
  const installPath = join(path, getGameInfo(appName).folder_name ?? appName)
  return runDownloadAndInstall(appName, installPath, 'installing')
}

export async function update(appName: string): Promise<InstallResult> {
  const installed = getInstalled(appName)
  if (!installed) {
    return { status: 'error', error: 'Game is not installed' }
  }
  // Humble has no patching, so updates re-download the full archive
  try {
    if (existsSync(installed.install_path)) {
      await rm(installed.install_path, { recursive: true, force: true })
    }
  } catch (error) {
    logWarning(
      [`Could not clean install path before update for ${appName}:`, error],
      LogPrefix.Humble
    )
  }
  return runDownloadAndInstall(appName, installed.install_path, 'updating')
}

export function isNative(appName?: string): boolean {
  if (!appName) return false
  const installed = getInstalled(appName)
  const platform: HumbleInstallPlatform | undefined = installed?.platform
  if (!platform) {
    const info = humbleGetGameInfo(appName)
    if (info?.is_linux_native && isLinux) return true
    if (info?.is_mac_native && isMac) return true
    return isWindows
  }
  if (platform === 'windows') return isWindows
  if (platform === 'linux') return isLinux
  if (platform === 'osx') return isMac
  return false
}

export async function addShortcuts(appName: string, fromMenu?: boolean) {
  return addShortcutsUtil(getGameInfo(appName), fromMenu)
}

export async function removeShortcuts(appName: string) {
  return removeShortcutsUtil(getGameInfo(appName))
}

export async function launch(
  appName: string,
  logWriter: LogWriter,
  launchArguments?: LaunchOption,
  args: string[] = []
): Promise<boolean> {
  const gameSettings = await getSettings(appName)
  const gameInfo = getGameInfo(appName)
  const installed = getInstalled(appName)
  if (!installed?.install_path) {
    logWriter.logError(`Cannot launch ${appName}: not installed`)
    return false
  }

  const {
    success: launchPrepSuccess,
    failureReason: launchPrepFailReason,
    rpcClient,
    mangoHudCommand,
    gameModeBin,
    gameScopeCommand,
    steamRuntime
  } = await prepareLaunch(gameSettings, logWriter, gameInfo, isNative(appName))

  if (!launchPrepSuccess) {
    logWriter.logError(['Launch aborted:', launchPrepFailReason])
    launchCleanup()
    showDialogBoxModalAuto({
      title: t('box.error.launchAborted', 'Launch aborted'),
      message: launchPrepFailReason!,
      type: 'ERROR'
    })
    return false
  }

  let executable = installed.executable
  if (launchArguments?.type === 'altExe') {
    executable = launchArguments.executable
  } else if (gameSettings.targetExe) {
    executable = gameSettings.targetExe
  }
  if (!executable) {
    logWriter.logError(
      `No executable recorded for ${appName}; cannot launch automatically`
    )
    showDialogBoxModalAuto({
      title: t('box.error.launchAborted', 'Launch aborted'),
      message: t(
        'humble.no_executable',
        'Heroic could not auto-detect a launcher for this Humble game. Set the target executable in game settings.'
      ),
      type: 'ERROR'
    })
    return false
  }

  const wrappers = setupWrappers(
    gameSettings,
    mangoHudCommand,
    gameModeBin,
    gameScopeCommand,
    steamRuntime?.length ? [...steamRuntime] : undefined
  )

  let commandEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...setupWrapperEnvVars({ appName, appRunner: 'humble' }),
    ...(isWindows ? {} : setupEnvVars(gameSettings, installed.install_path)),
    ...getKnownFixesEnvVariables(appName, 'humble')
  }

  let cmd = executable
  let cmdArgs: string[] = [
    ...shlex.split(
      launchArguments &&
        launchArguments.type !== 'altExe' &&
        launchArguments.type !== 'dlc'
        ? (launchArguments.parameters ?? '')
        : ''
    ),
    ...shlex.split(gameSettings.launcherArgs ?? ''),
    ...args
  ]

  if (!isNative(appName)) {
    const {
      success: wineLaunchPrepSuccess,
      failureReason: wineLaunchPrepFailReason,
      envVars: wineEnvVars
    } = await prepareWineLaunch('humble', appName, logWriter)
    if (!wineLaunchPrepSuccess) {
      logWriter.logError(['Launch aborted:', wineLaunchPrepFailReason])
      if (wineLaunchPrepFailReason) {
        showDialogBoxModalAuto({
          title: t('box.error.launchAborted', 'Launch aborted'),
          message: wineLaunchPrepFailReason,
          type: 'ERROR'
        })
      }
      return false
    }
    commandEnv = { ...commandEnv, ...wineEnvVars }
    const wineFlags = await getWineFlagsArray(
      gameSettings,
      shlex.join(wrappers)
    )
    cmd = wrappers[0] ?? wineFlags[0] ?? cmd
    cmdArgs = [...wineFlags.slice(1), executable, ...cmdArgs]
  } else if (wrappers.length) {
    cmd = wrappers[0]
    cmdArgs = [...wrappers.slice(1), executable, ...cmdArgs]
  }

  sendGameStatusUpdate({ appName, runner: 'humble', status: 'playing' })

  return new Promise<boolean>((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      env: commandEnv,
      cwd: installed.install_path,
      stdio: 'pipe'
    })
    child.stdout?.on('data', (d: Buffer) => logWriter.logInfo(d.toString()))
    child.stderr?.on('data', (d: Buffer) => logWriter.logInfo(d.toString()))
    child.on('error', (err) => {
      logError(['Failed to launch Humble game:', err], LogPrefix.Humble)
      launchCleanup(rpcClient)
      resolve(false)
    })
    child.on('exit', (code) => {
      launchCleanup(rpcClient)
      logInfo([`${gameInfo.title} exited with code ${code}`], LogPrefix.Humble)
      resolve(code === 0 || code === null)
    })
  })
}

export async function moveInstall(
  appName: string,
  newInstallPath: string
): Promise<InstallResult> {
  const gameInfo = getGameInfo(appName)
  logInfo(`Moving ${gameInfo.title} to ${newInstallPath}`, LogPrefix.Humble)
  const moveImpl = isWindows ? moveOnWindows : moveOnUnix
  const moveResult = await moveImpl(newInstallPath, gameInfo)
  if (moveResult.status === 'error') {
    logError(
      ['Error moving', gameInfo.title, 'to', newInstallPath, moveResult.error],
      LogPrefix.Humble
    )
    return { status: 'error', error: moveResult.error }
  }
  await humbleChangeInstallPath(appName, moveResult.installPath)
  return { status: 'done' }
}

export async function repair(appName: string): Promise<ExecResult> {
  // No manifest support — fall back to a fresh download
  const result = await update(appName)
  return {
    stdout: '',
    stderr: '',
    error: result.status === 'error' ? result.error : undefined
  }
}

export async function syncSaves(): Promise<string> {
  return ''
}

export async function uninstall({ appName }: RemoveArgs): Promise<ExecResult> {
  const installed = getInstalled(appName)
  if (!installed) {
    return { stdout: '', stderr: 'Game is not installed' }
  }
  try {
    if (existsSync(installed.install_path)) {
      await rm(installed.install_path, { recursive: true, force: true })
    }
  } catch (error) {
    logError(
      [`Failed to remove install folder for ${appName}:`, error],
      LogPrefix.Humble
    )
    return { stdout: '', stderr: `${error}` }
  }
  const gameInfo = getGameInfo(appName)
  await removeShortcutsUtil(gameInfo)
  await removeNonSteamGame({ gameInfo })
  removeInstalled(appName)
  installState(appName, false)
  sendFrontendMessage('refreshLibrary', 'humble')
  return { stdout: '', stderr: '' }
}

export async function forceUninstall(appName: string) {
  removeInstalled(appName)
  refreshInstalled()
}

export async function stop(appName: string, stopWine = true) {
  const installed = getInstalled(appName)
  const ctrl = abortControllers.get(appName)
  if (ctrl) ctrl.abort()
  if (installed?.executable) {
    killPattern(installed.executable.split(/[\\/]/).pop() ?? appName)
  } else {
    killPattern(appName)
  }
  if (stopWine && !isNative(appName)) {
    const gameSettings = await getSettings(appName)
    await shutdownWine(gameSettings)
  }
}

export async function isGameAvailable(appName: string): Promise<boolean> {
  const installed = getInstalled(appName)
  return Boolean(installed && existsSync(installed.install_path))
}

function humanBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function estimateEta(
  downloaded: number,
  total: number,
  speedBytesPerSecond: number
): string {
  if (!total || speedBytesPerSecond <= 0) return ''
  const remaining = (total - downloaded) / speedBytesPerSecond
  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  const seconds = Math.floor(remaining % 60)
  return [hours, minutes, seconds]
    .map((v) => v.toString().padStart(2, '0'))
    .join(':')
}
