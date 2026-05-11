/**
 * Process-wide butlerd client accessor.
 *
 * Other modules in `storeManagers/itchio/*` should call `withButlerd(fn)` or
 * `getClient()` rather than touching `ButlerdClient` directly — that way the
 * binary lookup, db path and user-agent are resolved in one place and the
 * daemon is spawned lazily on first use.
 */

import { join } from 'path'

import { ButlerdClient, getButlerdClient } from './butlerdClient'
import { butlerDbPath, itchioConfigPath } from './constants'
import { getButlerBin } from 'backend/utils'
import { LogPrefix, logError } from 'backend/logger'
import { app } from 'electron'

let cachedUserAgent: string | undefined

function getUserAgent(): string {
  if (!cachedUserAgent) {
    cachedUserAgent = `heroic/${app.getVersion?.() ?? 'dev'}`
  }
  return cachedUserAgent
}

export async function getClient(): Promise<ButlerdClient> {
  const { dir, bin } = getButlerBin()
  return getButlerdClient(join(dir, bin), butlerDbPath, getUserAgent())
}

export async function withButlerd<T>(
  fn: (client: ButlerdClient) => Promise<T>
): Promise<T> {
  const client = await getClient()
  try {
    return await fn(client)
  } catch (err) {
    logError(
      ['butlerd call failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    throw err
  }
}

export { butlerDbPath, itchioConfigPath }
