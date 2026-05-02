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
import { existsSync } from 'graceful-fs'
import { rm } from 'fs/promises'
import { isWindows } from 'backend/constants/environment'
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
import { showDialogBoxModalAuto } from 'backend/dialog/dialog'
import { t } from 'i18next'
import { join } from 'path'
import {
  downloadToTempFile,
  findGameExecutable,
  runInstaller
} from './installers'
import { HumbleInstalledInfo } from 'common/types/humble'
import { launchGame } from 'backend/storeManagers/storeManagerCommon/games'

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

    await runInstaller({
      appName,
      archivePath: tempFile,
      installPath,
      gameSettings
    })

    // The InnoSetup / MojoSetup runs are silent and don't tell us what the
    // game's main executable is, so scan the install folder ourselves.
    const discoveredExe = findGameExecutable(
      installPath,
      entry.subproduct.human_name
    )
    if (!discoveredExe) {
      logWarning(
        `Could not auto-detect a launcher exe for ${appName} in ${installPath}; user will need to set targetExe in game settings`,
        LogPrefix.Humble
      )
    } else {
      logInfo(
        [`Auto-detected launcher for ${appName}: ${discoveredExe}`],
        LogPrefix.Humble
      )
    }

    const installed: HumbleInstalledInfo = {
      app_name: appName,
      gamekey: entry.order.gamekey,
      subproduct_machine_name: entry.subproduct.machine_name,
      install_path: installPath,
      platform: installInfo.game.platform,
      executable: discoveredExe,
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isNative(_appName?: string): boolean {
  // MVP: Humble runner only ever installs the Windows download, so the
  // game is "native" only on Windows hosts. On Linux/Mac it always runs
  // through the configured Wine/Proton/CrossOver prefix.
  return isWindows
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _launchArguments?: LaunchOption,
  args: string[] = []
): Promise<boolean> {
  // Delegate to the same launcher Sideload uses: it handles
  // prepareLaunch / prepareWineLaunch / wrappers / proton verbs / target
  // exe override, all in one place. The Humble-specific work (download,
  // install, exe discovery) is already done by `install()`, which sets
  // gameInfo.install.executable so this lookup succeeds.
  const gameInfo = getGameInfo(appName)
  const settings = await getSettings(appName)
  const resolvedExe = settings.targetExe?.length
    ? settings.targetExe
    : gameInfo.install.executable

  logInfo(
    [
      `Launching Humble ${appName} —`,
      `install_path=${gameInfo.install.install_path ?? '<unset>'}`,
      `executable=${resolvedExe ?? '<unset>'}`,
      `targetExe=${settings.targetExe || '<unset>'}`,
      `isNative=${isNative(appName)}`
    ],
    LogPrefix.Humble
  )
  logWriter.logInfo(
    `Humble launch: install_path=${gameInfo.install.install_path}, executable=${resolvedExe}, isNative=${isNative(appName)}`
  )

  if (!resolvedExe) {
    logError(
      `No executable for ${appName}; auto-detection didn't find one and the user hasn't set targetExe`,
      LogPrefix.Humble
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

  const ok = await launchGame(appName, logWriter, gameInfo, 'humble', args)
  if (!ok) {
    logError(
      [
        `Humble launch returned false for ${appName} —`,
        'see log above for the wine/proton command details'
      ],
      LogPrefix.Humble
    )
  }
  return ok
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
