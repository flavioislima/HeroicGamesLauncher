/**
 * itch.io library manager. Wraps butlerd's `Fetch.*` methods to populate the
 * Heroic library. This file is scaffolding — every operation is wired up to
 * the manager registry but returns a safe default until the butlerd client
 * implementation lands in PR #2.
 */

import {
  ExecResult,
  GameInfo,
  InstallInfo,
  InstallPlatform,
  LaunchOption
} from 'common/types'

import { LogPrefix, logDebug, logInfo } from 'backend/logger'

import { ItchioUser } from './user'

const library: Map<string, GameInfo> = new Map()

export async function initItchioLibraryManager(): Promise<void> {
  if (!ItchioUser.isLoggedIn()) {
    logDebug(
      'itch.io: not logged in, skipping initial refresh',
      LogPrefix.Itchio
    )
    return
  }
  await refresh()
}

export function refresh(): Promise<ExecResult | null> {
  logInfo(
    'itch.io library refresh requested (not yet implemented)',
    LogPrefix.Itchio
  )
  return Promise.resolve(null)
}

export function getGameInfo(appName: string): GameInfo | undefined {
  return library.get(appName)
}

export function getInstallInfo(
  appName: string,
  installPlatform: InstallPlatform,
  options: { branch?: string; build?: string; lang?: string; retries?: number }
): Promise<InstallInfo | undefined> {
  logDebug(
    [
      `itch.io getInstallInfo(${appName}, ${installPlatform}) not implemented; options:`,
      options
    ],
    LogPrefix.Itchio
  )
  return Promise.resolve(undefined)
}

export function listUpdateableGames(): Promise<string[]> {
  // TODO: butlerd `CheckUpdate` over all installed caves.
  return Promise.resolve([])
}

export function changeGameInstallPath(
  appName: string,
  newPath: string
): Promise<void> {
  logDebug(
    `itch.io changeGameInstallPath(${appName}, ${newPath}) not implemented`,
    LogPrefix.Itchio
  )
  return Promise.resolve()
}

export function changeVersionPinnedStatus(
  appName: string,
  status: boolean
): void {
  // itch.io doesn't ship a per-build pinning concept like GOG; no-op for now.
  logDebug(
    `itch.io changeVersionPinnedStatus(${appName}, ${status}) is a no-op`,
    LogPrefix.Itchio
  )
}

export function installState(appName: string, state: boolean): void {
  // TODO: persist installed-state changes once `Install.Perform` is wired.
  logDebug(
    `itch.io installState(${appName}, ${state}) not implemented`,
    LogPrefix.Itchio
  )
}

export function getLaunchOptions(appName: string): LaunchOption[] {
  // TODO: derive from butlerd `Launch` manifest actions.
  logDebug(
    `itch.io getLaunchOptions(${appName}) returning empty list`,
    LogPrefix.Itchio
  )
  return []
}
