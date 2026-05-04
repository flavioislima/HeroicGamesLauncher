import axios from 'axios'
import { readFileSync, writeFileSync, mkdirSync } from 'graceful-fs'
import { LogPrefix, logDebug, logInfo, logWarning } from 'backend/logger'
import { humbleConfigPath } from './constants'
import { join } from 'path'

// Look titles up via the Bottles SteamGridDB proxy — same one the
// sideloaded-games dialog uses, no API key required. The endpoint
// returns a single image URL (typically 600×900 grid art) suitable for
// both the library card and the game-page hero.

interface HumbleArtwork {
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
  try {
    cache = JSON.parse(
      readFileSync(ARTWORK_CACHE_PATH, 'utf-8')
    ) as ArtworkCache
    return cache
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logWarning(
        ['Could not parse Humble artwork cache, resetting:', error],
        LogPrefix.Humble
      )
    }
    cache = {}
    return cache
  }
}

function saveCache() {
  if (!cache) return
  mkdirSync(humbleConfigPath, { recursive: true })
  writeFileSync(ARTWORK_CACHE_PATH, JSON.stringify(cache), 'utf-8')
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

// Idempotent: returns the cached entry if we've already tried, regardless
// of whether the lookup succeeded — re-asking on every refresh would be
// wasteful.
async function discoverArtwork(
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
  return entry
}

export async function discoverArtworkForMany(
  subproducts: { machine_name: string; human_name: string }[]
): Promise<void> {
  const c = loadCache()
  const uncached = subproducts.filter((s) => !c[s.machine_name])
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
    // Persist after each batch so a crash mid-enrichment doesn't lose
    // everything we already learned.
    saveCache()
  }
}
