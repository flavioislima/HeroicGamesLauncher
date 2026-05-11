/**
 * itch.io game manager. Like `library.ts`, this file is scaffolding: every
 * method satisfies the `GameManager` contract so the runner can be added to
 * `gameManagerMap`, but the actual butlerd calls land in PR #2.
 */

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

import { getGameInfo as getItchioLibraryGameInfo } from './library'

const NOT_IMPLEMENTED =
  'itch.io integration: butlerd command not yet implemented'

function logNotImplemented(operation: string, details: object): void {
  logWarning(
    [`${NOT_IMPLEMENTED} (operation=${operation})`, details],
    LogPrefix.Itchio
  )
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
  logNotImplemented('getExtraInfo', { appName })
  return Promise.resolve({
    about: { description: '', shortDescription: '' },
    reqs: [],
    releaseDate: undefined,
    storeUrl: undefined,
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
  // Progress will come from butlerd notifications once wired.
  logNotImplemented('onInstallOrUpdateOutput', {
    appName,
    action,
    dataLength: data.length,
    totalDownloadSize
  })
}

export function install(
  appName: string,
  args: InstallArgs
): Promise<InstallResult> {
  logNotImplemented('install', { appName, args })
  return Promise.resolve({ status: 'error', error: NOT_IMPLEMENTED })
}

export function isNative(appName: string): boolean {
  // Conservative: assume Windows-target until butlerd reports the upload's
  // native platform. Linux/macOS detection happens in PR #2.
  logInfo(
    `itch.io isNative(${appName}) returning false (not yet implemented)`,
    LogPrefix.Itchio
  )
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

export function launch(
  appName: string,
  logWriter: LogWriter,
  launchArguments?: LaunchOption,
  args?: string[],
  skipVersionCheck?: boolean
): Promise<boolean> {
  logNotImplemented('launch', {
    appName,
    launchArguments,
    args,
    skipVersionCheck,
    hasLogWriter: Boolean(logWriter)
  })
  return Promise.resolve(false)
}

export function moveInstall(
  appName: string,
  newInstallPath: string
): Promise<InstallResult> {
  logNotImplemented('moveInstall', { appName, newInstallPath })
  return Promise.resolve({ status: 'error', error: NOT_IMPLEMENTED })
}

export function repair(appName: string): Promise<ExecResult> {
  logNotImplemented('repair', { appName })
  return Promise.resolve({ stdout: '', stderr: NOT_IMPLEMENTED })
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

export function uninstall(args: RemoveArgs): Promise<ExecResult> {
  logNotImplemented('uninstall', { args })
  return Promise.resolve({ stdout: '', stderr: NOT_IMPLEMENTED })
}

export function update(appName: string): Promise<InstallResult> {
  logNotImplemented('update', { appName })
  return Promise.resolve({ status: 'error', error: NOT_IMPLEMENTED })
}

export function forceUninstall(appName: string): Promise<void> {
  logNotImplemented('forceUninstall', { appName })
  return Promise.resolve()
}

export function stop(appName: string, stopWine?: boolean): Promise<void> {
  logNotImplemented('stop', { appName, stopWine })
  return Promise.resolve()
}

export function isGameAvailable(appName: string): Promise<boolean> {
  logInfo(
    `itch.io isGameAvailable(${appName}) returning false (not yet implemented)`,
    LogPrefix.Itchio
  )
  return Promise.resolve(false)
}
