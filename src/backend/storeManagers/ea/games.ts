import {
  ExecResult,
  ExtraInfo,
  GameInfo,
  GameSettings,
  InstallArgs,
  InstallPlatform,
  InstallProgress,
  LaunchOption
} from 'common/types'
import { InstallResult, RemoveArgs } from 'common/types/game_manager'
import {
  runRunnerCommand as runEACommand,
  getGameInfo as eaLibraryGetGameInfo,
  changeGameInstallPath,
  installState,
  removeFromInstalledConfig,
  getInstallMetadata
} from './library'
import {
  LogPrefix,
  logDebug,
  logError,
  logInfo,
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
import { existsSync, rmSync } from 'graceful-fs'
import { showDialogBoxModalAuto } from 'backend/dialog/dialog'
import { t } from 'i18next'
import {
  getWineFlagsArray,
  isUmuSupported
} from 'backend/utils/compatibility_layers'
import shlex from 'shlex'
import {
  killPattern,
  moveOnUnix,
  moveOnWindows,
  sendGameStatusUpdate,
  sendProgressUpdate,
  shutdownWine
} from 'backend/utils'
import { GlobalConfig } from 'backend/config'
import {
  addShortcuts as addShortcutsUtil,
  removeShortcuts as removeShortcutsUtil
} from '../../shortcuts/shortcuts/shortcuts'
import { removeNonSteamGame } from 'backend/shortcuts/nonesteamgame/nonesteamgame'
import { sendFrontendMessage } from '../../ipc'
import setup from './setup'
import { getUmuId } from 'backend/wiki_game_info/umu/utils'
import { isLinux, isWindows } from 'backend/constants/environment'

import type LogWriter from 'backend/logger/log_writer'

export async function getSettings(appName: string): Promise<GameSettings> {
  const gameConfig = GameConfig.get(appName)
  return gameConfig.config || (await gameConfig.getSettings())
}

export function getGameInfo(appName: string): GameInfo {
  const info = eaLibraryGetGameInfo(appName)
  if (!info) {
    logError(
      [
        'Could not get EA game info for',
        `${appName},`,
        'returning empty object'
      ],
      LogPrefix.EA
    )
    return {
      app_name: '',
      runner: 'ea',
      art_cover: '',
      art_square: '',
      install: {},
      is_installed: false,
      title: '',
      canRunOffline: false
    }
  }
  return info
}

export async function getExtraInfo(appName: string): Promise<ExtraInfo> {
  const info = eaLibraryGetGameInfo(appName)
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
  folderPath: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  platform: InstallPlatform
): Promise<ExecResult> {
  const importLogWriter = await createGameLogWriter(appName, 'ea', 'import')
  // Maxima exposes `locate-game <path>` (no slug arg). It scans the
  // directory and infers which offer the install belongs to.
  const res = await runEACommand(['locate-game', folderPath], {
    abortId: appName,
    logWriters: [importLogWriter],
    logMessagePrefix: `Importing ${appName}`
  })

  if (res.abort) return res

  if (res.error) {
    logError(['Failed to import EA', `${appName}:`, res.error], LogPrefix.EA)
    return res
  }

  try {
    addShortcuts(appName)
    installState(appName, true)
  } catch (error) {
    logError(['Failed to import EA', `${appName}:`, error], LogPrefix.EA)
  }

  return res
}

interface tmpProgressMap {
  [key: string]: InstallProgress
}

function defaultTmpProgress() {
  return {
    bytes: '',
    eta: '',
    percent: undefined,
    diskSpeed: undefined,
    downSpeed: undefined
  }
}
const tmpProgress: tmpProgressMap = {}

export function onInstallOrUpdateOutput(
  appName: string,
  action: 'installing' | 'updating',
  data: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  totalDownloadSize = -1
) {
  if (!Object.hasOwn(tmpProgress, appName)) {
    tmpProgress[appName] = defaultTmpProgress()
  }
  const progress = tmpProgress[appName]

  // Maxima logs progress through `tracing::info!` lines, e.g.
  //   "Downloaded 142.30 MiB / 5.20 GiB (2.6%) at 38.4 MiB/s"
  if (!progress.percent) {
    const percentMatch = data.match(/\((\d+\.\d+)%\)/m)
    progress.percent = !Number.isNaN(Number(percentMatch?.at(1)))
      ? Number(percentMatch?.at(1))
      : undefined
  }

  if (progress.eta === '') {
    const etaMatch = data.match(/ETA[: ]+(\d{1,2}:\d{2}(?::\d{2})?)/m)
    progress.eta = etaMatch?.[1] ?? ''
  }

  if (progress.bytes === '') {
    const bytesMatch = data.match(/Downloaded ([\d.]+) (KiB|MiB|GiB)/m)
    if (bytesMatch) {
      progress.bytes = `${bytesMatch[1]}${bytesMatch[2].replace('i', '')}`
    }
  }

  if (!progress.downSpeed) {
    const downMatch = data.match(/at ([\d.]+) (KiB|MiB|GiB)\/s/m)
    progress.downSpeed = !Number.isNaN(Number(downMatch?.at(1)))
      ? Number(downMatch?.at(1))
      : undefined
  }

  if (!progress.diskSpeed) {
    // Maxima doesn't separate disk speed today; reuse downSpeed so
    // the frontend has something to render.
    progress.diskSpeed = progress.downSpeed
  }

  if (
    Object.values(progress).every(
      (value) => !(value === undefined || value === '')
    )
  ) {
    logInfo(
      [
        `Progress for ${getGameInfo(appName).title}:`,
        `${progress.percent}%/${progress.bytes}/${progress.eta}`.trim(),
        `Down: ${progress.downSpeed}MB/s / Disk: ${progress.diskSpeed}MB/s`
      ],
      LogPrefix.EA
    )

    sendProgressUpdate({
      appName,
      runner: 'ea',
      status: action,
      progress
    })

    tmpProgress[appName] = defaultTmpProgress()
  }
}

export async function install(
  appName: string,
  { path }: InstallArgs
): Promise<InstallResult> {
  const { maxWorkers } = GlobalConfig.get().getSettings()
  const workers = maxWorkers ? ['--max-workers', `${maxWorkers}`] : []

  // Maxima's CLI install path is the interactive menu today. The
  // command shape we plumb here matches the upstream RFC for an
  // `install <slug-or-offer-id>` subcommand. Until that ships, this
  // call will fail and surface in the UI as an install error.
  const commandParts = ['install', '--base-path', path, ...workers, appName]

  const onOutput = (data: string) => {
    onInstallOrUpdateOutput(appName, 'installing', data)
  }

  const installLogWriter = await createGameLogWriter(appName, 'ea', 'install')
  const res = await runEACommand(commandParts, {
    abortId: appName,
    logWriters: [installLogWriter],
    onOutput,
    logMessagePrefix: `Installing ${appName}`
  })

  if (res.abort) return { status: 'abort' }

  if (res.error) {
    if (!res.error.includes('signal')) {
      logError(['Failed to install EA', appName, res.error], LogPrefix.EA)
    }
    return { status: 'error', error: res.error }
  }
  addShortcuts(appName)
  installState(appName, true)
  const metadata = getInstallMetadata(appName)

  // Always run the registry setup; Maxima's install pipeline writes
  // the keys on Windows but not in our managed Wine prefix.
  await setup(appName, metadata?.path)

  return { status: 'done' }
}

export function isNative(): boolean {
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
  launchArguments?: LaunchOption,
  args: string[] = []
): Promise<boolean> {
  const gameSettings = await getSettings(appName)
  const gameInfo = getGameInfo(appName)

  const {
    success: launchPrepSuccess,
    failureReason: launchPrepFailReason,
    rpcClient,
    mangoHudCommand,
    gameModeBin,
    gameScopeCommand,
    steamRuntime
  } = await prepareLaunch(gameSettings, logWriter, gameInfo, isNative())

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

  let exeOverrideFlag: string[] = []
  if (launchArguments?.type === 'altExe') {
    exeOverrideFlag = ['--game-path', launchArguments.executable]
  } else if (gameSettings.targetExe) {
    exeOverrideFlag = ['--game-path', gameSettings.targetExe]
  }

  let commandEnv = {
    ...process.env,
    ...setupWrapperEnvVars({ appName, appRunner: 'ea' }),
    ...(isWindows
      ? {}
      : setupEnvVars(gameSettings, gameInfo.install.install_path)),
    ...getKnownFixesEnvVariables(appName, 'ea')
  }

  const wrappers = setupWrappers(
    gameSettings,
    mangoHudCommand,
    gameModeBin,
    gameScopeCommand,
    steamRuntime?.length ? [...steamRuntime] : undefined
  )

  let wineFlag: string[] = wrappers.length
    ? ['--wrapper', shlex.join(wrappers)]
    : []

  if (!isNative()) {
    const {
      success: wineLaunchPrepSuccess,
      failureReason: wineLaunchPrepFailReason,
      envVars: wineEnvVars
    } = await prepareWineLaunch('ea', appName, logWriter)
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

    commandEnv = {
      ...commandEnv,
      ...wineEnvVars
    }

    if (await isUmuSupported(gameSettings)) {
      const umuId = await getUmuId(gameInfo.app_name, gameInfo.runner)
      if (umuId) {
        commandEnv['GAMEID'] = umuId
      }
    }

    wineFlag = [
      ...(await getWineFlagsArray(gameSettings, shlex.join(wrappers))),
      '--wine-prefix',
      gameSettings.winePrefix
    ]
  }

  const launchArgumentsArgs =
    launchArguments &&
    (launchArguments.type === undefined || launchArguments.type === 'basic')
      ? launchArguments.parameters
      : ''

  // Maxima's `launch <slug>` subcommand accepts `--game-path`,
  // `--game-args`, and a global `--login` flag. We pass the runner
  // slug positional last to match its clap definitions.
  const commandParts = [
    'launch',
    ...exeOverrideFlag,
    ...wineFlag,
    ...(launchArgumentsArgs
      ? ['--game-args', shlex.join(shlex.split(launchArgumentsArgs))]
      : []),
    ...shlex.split(gameSettings.launcherArgs ?? ''),
    appName,
    ...args
  ]

  sendGameStatusUpdate({ appName, runner: 'ea', status: 'playing' })

  const { error } = await runEACommand(commandParts, {
    abortId: appName,
    env: commandEnv,
    wrappers,
    logMessagePrefix: `Launching ${gameInfo.title}`,
    logWriters: [logWriter]
  })

  if (error) {
    logError(['Error launching EA game:', error], LogPrefix.EA)
  }

  launchCleanup(rpcClient)

  return !error
}

export async function moveInstall(
  appName: string,
  newInstallPath: string
): Promise<InstallResult> {
  const gameInfo = getGameInfo(appName)
  logInfo(`Moving ${gameInfo.title} to ${newInstallPath}`, LogPrefix.EA)

  const moveImpl = isWindows ? moveOnWindows : moveOnUnix
  const moveResult = await moveImpl(newInstallPath, gameInfo)

  if (moveResult.status === 'error') {
    const { error } = moveResult
    logError(
      ['Error moving', gameInfo.title, 'to', newInstallPath, error],
      LogPrefix.EA
    )
    return { status: 'error', error }
  }

  await changeGameInstallPath(appName, moveResult.installPath)
  return { status: 'done' }
}

export async function repair(appName: string): Promise<ExecResult> {
  const installInfo = getGameInfo(appName)
  const { install_path } = installInfo.install ?? {}

  if (!install_path) {
    const error = `Could not find install path for ${appName}`
    logError(error, LogPrefix.EA)
    return { stderr: '', stdout: '', error }
  }

  logDebug([appName, 'is installed at', install_path], LogPrefix.EA)
  const repairLogWriter = await createGameLogWriter(appName, 'ea', 'repair')
  // No `verify` subcommand in Maxima today; route through `install`
  // with a `--verify` flag. Will fail until upstream supports it.
  const res = await runEACommand(['install', '--verify', appName], {
    abortId: appName,
    logWriters: [repairLogWriter],
    logMessagePrefix: `Repairing ${appName}`
  })

  if (res.error) {
    logError(['Failed to repair EA', `${appName}:`, res.error], LogPrefix.EA)
  }
  return res
}

export async function syncSaves(appName: string, arg: string): Promise<string> {
  // Maxima exposes `cloud-sync <slug> [--write]`. The semantics differ
  // from Heroic's GOG/Legendary cloud-sync flags; we map "Upload" to
  // --write and treat anything else as a download.
  const args =
    arg === 'Upload' || arg === 'Force upload'
      ? ['cloud-sync', appName, '--write']
      : ['cloud-sync', appName]

  const { stdout, error } = await runEACommand(args, {
    abortId: `${appName}-cloud-sync`
  })

  if (error) {
    logError(['EA cloud-sync failed:', error], LogPrefix.EA)
    return error
  }
  return stdout
}

export async function uninstall({
  appName,
  deleteFiles = true
}: RemoveArgs): Promise<ExecResult> {
  // Maxima ships no `uninstall` subcommand. We do the cleanup
  // ourselves: delete files, drop the entry from installed.json, and
  // (best-effort) remove the EA Games registry keys we wrote at setup.
  const gameInfo = getGameInfo(appName)
  const installPath = gameInfo.install?.install_path

  if (deleteFiles && installPath && existsSync(installPath)) {
    try {
      rmSync(installPath, { recursive: true, force: true })
    } catch (err) {
      logError(
        ['Failed to delete EA install dir', installPath, err],
        LogPrefix.EA
      )
    }
  }

  removeFromInstalledConfig(appName)
  installState(appName, false)
  await removeShortcutsUtil(gameInfo)
  await removeNonSteamGame({ gameInfo })

  sendFrontendMessage('refreshLibrary', 'ea')
  return { stdout: '', stderr: '' }
}

export async function update(appName: string): Promise<InstallResult> {
  const { maxWorkers } = GlobalConfig.get().getSettings()
  const workers = maxWorkers ? ['--max-workers', `${maxWorkers}`] : []

  // No dedicated `update` subcommand in Maxima; running install against
  // an already-located game triggers the DiP delta install pipeline.
  const commandParts = ['install', '--update', ...workers, appName]

  const onOutput = (data: string) => {
    onInstallOrUpdateOutput(appName, 'updating', data)
  }

  const updateLogWriter = await createGameLogWriter(appName, 'ea', 'update')
  const res = await runEACommand(commandParts, {
    abortId: appName,
    logWriters: [updateLogWriter],
    onOutput,
    logMessagePrefix: `Updating ${appName}`
  })

  if (res.abort) return { status: 'abort' }

  if (res.error) {
    if (!res.error.includes('signal')) {
      logError(['Failed to update EA', appName, res.error], LogPrefix.EA)
    }
    return { status: 'error', error: res.error }
  }

  sendGameStatusUpdate({ appName, runner: 'ea', status: 'done' })
  return { status: 'done' }
}

export async function forceUninstall(appName: string) {
  removeFromInstalledConfig(appName)
}

export async function stop(appName: string, stopWine = true) {
  const pattern = isLinux ? appName : 'maxima'
  killPattern(pattern)

  if (stopWine && !isNative()) {
    const gameSettings = await getSettings(appName)
    await shutdownWine(gameSettings)
  }
}

export async function isGameAvailable(appName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const info = getGameInfo(appName)
    resolve(
      Boolean(
        info?.is_installed &&
        info.install.install_path &&
        existsSync(info.install.install_path)
      )
    )
  })
}
