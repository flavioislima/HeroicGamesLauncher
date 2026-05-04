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
import { existsSync, rmSync } from 'graceful-fs'
import { isMac, isWindows } from 'backend/constants/environment'
import {
  calculateEta,
  getFileSize,
  killPattern,
  moveOnUnix,
  moveOnWindows,
  sendGameStatusUpdate,
  sendProgressUpdate,
  shutdownWine
} from 'backend/utils'
import {
  createAbortController,
  deleteAbortController,
  callAbortController
} from 'backend/utils/aborthandler/aborthandler'
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
import { HumbleInstalledInfo, HumbleInstallPlatform } from 'common/types/humble'
import { launchGame } from 'backend/storeManagers/storeManagerCommon/games'

function toHumblePlatform(
  platform: InstallPlatform | undefined
): HumbleInstallPlatform {
  const lower = `${platform ?? ''}`.toLowerCase()
  if (lower === 'mac' || lower === 'osx' || lower === 'darwin') return 'osx'
  return 'windows'
}

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
  appName: string,
  path: string,
  platform: InstallPlatform
): Promise<ExecResult> {
  const entry = getCachedSubproduct(appName)
  if (!entry) {
    const error = `Humble subproduct ${appName} not found in cached library — log in and refresh first`
    logError(error, LogPrefix.Humble)
    return { stdout: '', stderr: error, error }
  }
  if (!existsSync(path)) {
    const error = `Import path does not exist: ${path}`
    logError(error, LogPrefix.Humble)
    return { stdout: '', stderr: error, error }
  }
  const humblePlatform = toHumblePlatform(platform)
  const installInfo = await getInstallInfo(appName, humblePlatform).catch(
    () => undefined
  )
  const discoveredExe = findGameExecutable(
    path,
    entry.subproduct.human_name,
    humblePlatform
  )
  if (!discoveredExe) {
    logWarning(
      `Imported ${appName} but no executable found under ${path}; user must set targetExe`,
      LogPrefix.Humble
    )
  }
  const installed: HumbleInstalledInfo = {
    app_name: appName,
    gamekey: entry.order.gamekey,
    subproduct_machine_name: entry.subproduct.machine_name,
    install_path: path,
    platform: installInfo?.game.platform ?? humblePlatform,
    executable: discoveredExe,
    md5: installInfo?.manifest.md5 ?? '',
    version: installInfo?.game.version ?? '',
    install_size: installInfo?.manifest.disk_size ?? 0
  }
  persistInstalled(installed)
  installState(appName, true)
  sendFrontendMessage('refreshLibrary', 'humble')
  logInfo(
    [
      `Imported ${appName} from ${path}; executable=${discoveredExe ?? '<unset>'}`
    ],
    LogPrefix.Humble
  )
  return { stdout: 'Imported', stderr: '' }
}

export function onInstallOrUpdateOutput(
  _appName: string,

  _action: 'installing' | 'updating',

  _data: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _totalDownloadSize = -1
) {
  // Stub: progress is dispatched directly from runDownload via sendProgressUpdate.
}

async function runDownloadAndInstall(
  appName: string,
  installPath: string,
  action: 'installing' | 'updating',
  platform: HumbleInstallPlatform
): Promise<InstallResult> {
  const entry = getCachedSubproduct(appName)
  if (!entry) {
    return {
      status: 'error',
      error: `Humble subproduct ${appName} not found in cached library`
    }
  }
  const installInfo = await getInstallInfo(appName, platform)
  if (!installInfo) {
    return {
      status: 'error',
      error: `Could not resolve Humble download URL for ${appName}`
    }
  }

  const abort = createAbortController(appName)
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
        // Round percent to one decimal — the raw float renders verbatim in
        // the progress UI otherwise (e.g. "90.0849633855638%").
        const progress = {
          percent: Number(percent.toFixed(1)),
          bytes: getFileSize(bytesDownloaded),
          eta:
            calculateEta(bytesDownloaded, speedBytesPerSecond, totalBytes) ??
            '',
          downSpeed: Number((speedBytesPerSecond / (1024 * 1024)).toFixed(2))
        }
        logInfo(
          [
            `Progress for ${entry.subproduct.human_name}:`,
            `${progress.percent}%/${progress.bytes}/${progress.eta}`.trim(),
            `Down: ${progress.downSpeed}MB/s`
          ],
          LogPrefix.Humble
        )
        sendProgressUpdate({
          appName,
          runner: 'humble',
          status: action,
          progress
        })
      }
    )

    await runInstaller({
      appName,
      archivePath: tempFile,
      installPath,
      title: entry.subproduct.human_name,
      gameSettings,
      platform: installInfo.game.platform
    })

    // InnoSetup / MojoSetup runs are silent and don't tell us where the
    // launcher landed, so scan the install folder ourselves.
    const discoveredExe = findGameExecutable(
      installPath,
      entry.subproduct.human_name,
      installInfo.game.platform
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
    sendFrontendMessage('refreshLibrary', 'humble')

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
    deleteAbortController(appName)
  }
}

export async function install(
  appName: string,
  { path, platformToInstall }: InstallArgs
): Promise<InstallResult> {
  const installLogWriter = await createGameLogWriter(
    appName,
    'humble',
    'install'
  )
  const platform = toHumblePlatform(platformToInstall)
  installLogWriter.logInfo(`Installing ${appName} (${platform}) to ${path}`)
  const installPath = join(path, getGameInfo(appName).folder_name ?? appName)
  return runDownloadAndInstall(appName, installPath, 'installing', platform)
}

export async function update(appName: string): Promise<InstallResult> {
  const installed = getInstalled(appName)
  if (!installed) {
    return { status: 'error', error: 'Game is not installed' }
  }
  // Humble has no patching, so updates re-download the full archive.
  try {
    if (existsSync(installed.install_path)) {
      rmSync(installed.install_path, { recursive: true, force: true })
    }
  } catch (error) {
    logWarning(
      [`Could not clean install path before update for ${appName}:`, error],
      LogPrefix.Humble
    )
  }
  return runDownloadAndInstall(
    appName,
    installed.install_path,
    'updating',
    installed.platform
  )
}

export function isNative(appName?: string): boolean {
  if (!appName) return isWindows
  const installed = getInstalled(appName)
  if (installed?.platform === 'osx') return isMac
  if (installed?.platform === 'windows') return isWindows
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

  _launchArguments?: LaunchOption,
  args: string[] = []
): Promise<boolean> {
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
  // No manifest support — fall back to a fresh download.
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
    logWarning(
      `Uninstall called for ${appName} but no install record exists`,
      LogPrefix.Humble
    )
    return { stdout: '', stderr: 'Game is not installed' }
  }
  const installPath = installed.install_path
  logInfo(
    [`Uninstalling ${appName} — removing install folder ${installPath}`],
    LogPrefix.Humble
  )
  if (installPath && existsSync(installPath)) {
    try {
      rmSync(installPath, { recursive: true, force: true })
    } catch (error) {
      logError(
        [`Failed to remove install folder ${installPath}:`, error],
        LogPrefix.Humble
      )
      return { stdout: '', stderr: `${error}` }
    }
    if (existsSync(installPath)) {
      logError(
        [`rmSync returned but ${installPath} still exists`],
        LogPrefix.Humble
      )
    } else {
      logInfo([`Removed ${installPath}`], LogPrefix.Humble)
    }
  } else {
    logWarning(
      [
        `Install folder ${installPath || '<empty>'} did not exist;`,
        `proceeding with metadata cleanup only`
      ],
      LogPrefix.Humble
    )
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
  callAbortController(appName)
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
