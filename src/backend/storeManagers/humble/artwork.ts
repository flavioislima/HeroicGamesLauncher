import axios from 'axios'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'graceful-fs'
import { LogPrefix, logDebug, logInfo, logWarning } from 'backend/logger'
import { humbleConfigPath } from './constants'
import { join } from 'path'

// Humble's API only exposes a small `subproduct.icon` per game, so we
// look the title up against the Bottles-hosted SteamGridDB proxy that's
// already used by Heroic's sideloaded-games dialog. It needs no API key
// and returns a single image URL (typically 600×900 grid art) suitable
// for both the library card and the game-page hero.

export interface HumbleArtwork {
  // Bottles only gives us one image, so all three slots share it.
  url?: string
  fetchedAt: number
}

type ArtworkCache = Record<string, HumbleArtwork>

const ARTWORK_CACHE_PATH = join(humbleConfigPath, 'artwork.json')
const BOTTLES_SEARCH = 'https://steamgrid.usebottles.com/api/search'

let cache: ArtworkCache | undefined

function loadCache(): ArtworkCache {
  if (cache) return cache
  if (!existsSync(ARTWORK_CACHE_PATH)) {
    cache = {}
    return cache
  }
  try {
    cache = JSON.parse(
      readFileSync(ARTWORK_CACHE_PATH, 'utf-8')
    ) as ArtworkCache
    return cache
  } catch (error) {
    logWarning(
      ['Could not parse Humble artwork cache, resetting:', error],
      LogPrefix.Humble
    )
    cache = {}
    return cache
  }
}

function saveCache() {
  if (!cache) return
  if (!existsSync(humbleConfigPath)) {
    mkdirSync(humbleConfigPath, { recursive: true })
  }
  writeFileSync(ARTWORK_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8')
}

export function getCachedArtwork(
  machineName: string
): HumbleArtwork | undefined {
  return loadCache()[machineName]
}

async function searchBottles(title: string): Promise<string | undefined> {
  try {
    const res = await axios.get(
      `${BOTTLES_SEARCH}/${encodeURIComponent(title)}`,
      { timeout: 5000, validateStatus: () => true }
    )
    if (
      res.status === 200 &&
      typeof res.data === 'string' &&
      res.data.startsWith('http')
    ) {
      return res.data
    }
    return undefined
  } catch (error) {
    logDebug(
      [`Bottles SGDB search failed for "${title}":`, error],
      LogPrefix.Humble
    )
    return undefined
  }
}

/**
 * Look up better artwork for a single subproduct. Idempotent: returns the
 * cached entry if we've already tried, regardless of whether the lookup
 * succeeded — the Bottles endpoint doesn't have every Humble title and
 * re-asking on every refresh would be wasteful.
 */
export async function discoverArtwork(
  machineName: string,
  humanName: string
): Promise<HumbleArtwork> {
  const cached = loadCache()[machineName]
  if (cached) return cached

  const url = await searchBottles(humanName)
  const entry: HumbleArtwork = { url, fetchedAt: Date.now() }
  if (url) {
    logInfo([`Found SGDB artwork for "${humanName}"`], LogPrefix.Humble)
  }
  loadCache()[machineName] = entry
  saveCache()
  return entry
}

/**
 * Enrich every subproduct that doesn't have a cached artwork entry yet.
 * Runs in parallel with a small concurrency window so we don't hammer
 * the proxy (or block the rest of the refresh).
 */
export async function discoverArtworkForMany(
  subproducts: { machine_name: string; human_name: string }[]
): Promise<void> {
  const uncached = subproducts.filter((s) => !loadCache()[s.machine_name])
  if (!uncached.length) return
  logInfo(
    [`Looking up artwork for ${uncached.length} new Humble title(s)`],
    LogPrefix.Humble
  )
  const concurrency = 4
  for (let i = 0; i < uncached.length; i += concurrency) {
    const batch = uncached.slice(i, i + concurrency)
    await Promise.all(
      batch.map((s) =>
        discoverArtwork(s.machine_name, s.human_name).catch(() => undefined)
      )
    )
  }
}

export function clearArtworkCache() {
  cache = {}
  saveCache()
}
