import axios from 'axios'
import { createHash } from 'crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  chmodSync
} from 'graceful-fs'
import { spawn } from 'child_process'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { LogPrefix, logError, logInfo } from 'backend/logger'
import { isWindows, isMac } from 'backend/constants/environment'
import { runWineCommand } from 'backend/launcher'
import { GameSettings } from 'common/types'

export interface DownloadProgress {
  bytesDownloaded: number
  totalBytes: number
  percent: number
  speedBytesPerSecond: number
}

export type ProgressCallback = (progress: DownloadProgress) => void

export async function downloadToTempFile(
  url: string,
  expectedMd5: string | undefined,
  abortSignal: AbortSignal | undefined,
  onProgress: ProgressCallback
): Promise<string> {
  if (!existsSync(tmpdir())) mkdirSync(tmpdir(), { recursive: true })
  const filename = basename(new URL(url).pathname) || 'humble-download'
  const tempPath = join(tmpdir(), `heroic-humble-${Date.now()}-${filename}`)

  const response = await axios.get(url, {
    responseType: 'stream',
    signal: abortSignal
  })

  const totalBytes = Number(response.headers['content-length'] ?? 0)
  const writer = createWriteStream(tempPath)
  const md5 = createHash('md5')

  let bytesDownloaded = 0
  let lastTick = Date.now()
  let lastBytes = 0

  await new Promise<void>((resolve, reject) => {
    response.data.on('data', (chunk: Buffer) => {
      bytesDownloaded += chunk.length
      md5.update(chunk)
      const now = Date.now()
      if (now - lastTick >= 500) {
        const elapsed = (now - lastTick) / 1000
        onProgress({
          bytesDownloaded,
          totalBytes,
          percent: totalBytes ? (bytesDownloaded / totalBytes) * 100 : 0,
          speedBytesPerSecond: (bytesDownloaded - lastBytes) / elapsed
        })
        lastTick = now
        lastBytes = bytesDownloaded
      }
    })
    response.data.on('error', reject)
    response.data.pipe(writer)
    writer.on('finish', () => resolve())
    writer.on('error', reject)
  })

  if (expectedMd5) {
    const actual = md5.digest('hex')
    if (actual.toLowerCase() !== expectedMd5.toLowerCase()) {
      try {
        unlinkSync(tempPath)
      } catch {
        // ignore
      }
      throw new Error(
        `Humble download MD5 mismatch (expected ${expectedMd5}, got ${actual})`
      )
    }
  }

  return tempPath
}

interface ExtractContext {
  appName: string
  archivePath: string
  installPath: string
  gameSettings?: GameSettings
}

/**
 * Run an installer or extract an archive depending on the file extension.
 * Returns the path to the extracted/installed game folder and (if known) the
 * primary executable.
 */
export async function runInstaller(
  ctx: ExtractContext
): Promise<{ executable?: string }> {
  const ext = extname(ctx.archivePath).toLowerCase()
  if (!existsSync(ctx.installPath)) {
    mkdirSync(ctx.installPath, { recursive: true })
  }

  if (ext === '.zip') {
    await extractZip(ctx.archivePath, ctx.installPath)
    return {}
  }

  if (
    ext === '.gz' ||
    ext === '.bz2' ||
    ext === '.xz' ||
    ext === '.tar' ||
    ctx.archivePath.endsWith('.tar.gz') ||
    ctx.archivePath.endsWith('.tar.bz2') ||
    ctx.archivePath.endsWith('.tar.xz')
  ) {
    await extractTar(ctx.archivePath, ctx.installPath)
    return {}
  }

  if (ext === '.sh') {
    return runShellInstaller(ctx)
  }

  if (ext === '.exe' || ext === '.msi') {
    return runWindowsInstaller(ctx)
  }

  throw new Error(
    `Unsupported Humble download type: ${ext} (${ctx.archivePath})`
  )
}

async function extractZip(archivePath: string, dest: string) {
  if (isWindows) {
    await runShell('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${dest}" -Force`
    ])
  } else {
    await runShell('unzip', ['-o', archivePath, '-d', dest])
  }
}

async function extractTar(archivePath: string, dest: string) {
  await runShell('tar', ['-xf', archivePath, '-C', dest])
}

async function runShellInstaller(
  ctx: ExtractContext
): Promise<{ executable?: string }> {
  if (isWindows) {
    throw new Error('Cannot run a .sh installer on Windows')
  }
  chmodSync(ctx.archivePath, 0o755)
  // MojoSetup-style flags accepted by most Humble Linux installers
  await runShell(ctx.archivePath, [
    '--noprompt',
    '--i-agree-to-all-licenses',
    '--destination',
    ctx.installPath
  ])
  return {}
}

async function runWindowsInstaller(
  ctx: ExtractContext
): Promise<{ executable?: string }> {
  if (isWindows) {
    // Most Humble Windows installers are InnoSetup; default to silent mode
    await runShell(ctx.archivePath, [
      '/SILENT',
      `/DIR=${ctx.installPath}`,
      '/NOICONS'
    ])
    return {}
  }
  if (isMac) {
    throw new Error(
      'Running .exe installers on macOS requires CrossOver or Wine; not yet supported'
    )
  }
  // Linux: run the installer through the game's Wine prefix
  if (!ctx.gameSettings) {
    throw new Error('Wine settings missing for .exe install')
  }
  const result = await runWineCommand({
    gameSettings: ctx.gameSettings,
    commandParts: [ctx.archivePath, '/SILENT', `/DIR=${ctx.installPath}`],
    wait: true,
    protonVerb: 'run'
  })
  if (result.code && result.code !== 0) {
    throw new Error(`Wine installer exited with code ${result.code}`)
  }
  return {}
}

function runShell(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    logInfo(['Running:', cmd, args.join(' ')], LogPrefix.Humble)
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else {
        logError([cmd, 'exited with code', `${code}`], LogPrefix.Humble)
        reject(new Error(`${cmd} exited with code ${code}`))
      }
    })
  })
}

// Patterns of .exe files that are clearly NOT the game launcher: bundled
// redistributables, uninstallers, crash reporters, etc.
const EXE_BLOCKLIST = [
  /^unins\d*\.exe$/i,
  /^vc_redist[^/]*\.exe$/i,
  /^vcredist[^/]*\.exe$/i,
  /^dxsetup\.exe$/i,
  /^directx[^/]*\.exe$/i,
  /^dxwebsetup\.exe$/i,
  /^dotnetfx[^/]*\.exe$/i,
  /^ndp\d+[^/]*\.exe$/i,
  /^oalinst\.exe$/i,
  /^physx[^/]*\.exe$/i,
  /^ueprereqsetup[^/]*\.exe$/i,
  /^crashreport(er)?\.exe$/i,
  /^crashsender[^/]*\.exe$/i,
  /^7z\.exe$/i,
  /^setup\.exe$/i
]

// Subdirectory name fragments that contain dependencies, not the game.
const DIR_BLOCKLIST = [
  '_commonredist',
  'redist',
  'redistributable',
  'directx',
  'dotnet',
  'vcredist',
  '$_outputs',
  'support'
]

function isLikelyGameExe(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase().replace(/\\/g, '/')
  if (DIR_BLOCKLIST.some((seg) => lowerPath.includes(`/${seg}/`))) {
    return false
  }
  const name = basename(filePath)
  if (EXE_BLOCKLIST.some((re) => re.test(name))) {
    return false
  }
  return true
}

interface ExeCandidate {
  path: string
  size: number
  depth: number
}

function walkExes(dir: string, out: ExeCandidate[], depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walkExes(full, out, depth + 1, maxDepth)
    } else if (entry.toLowerCase().endsWith('.exe')) {
      out.push({ path: full, size: stat.size, depth })
    }
  }
}

function tokensFromTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

/**
 * Scan an install folder for the most likely game executable. InnoSetup and
 * other Humble installers run silently and don't tell us where the launcher
 * landed, so we walk the tree and apply a few heuristics:
 *
 *  1. Filter out known redistributable / uninstaller / setup names.
 *  2. Prefer files at shallow depth (top-level "GameName.exe" beats
 *     `Engine/Binaries/Win64/...UnrealLauncher.exe`).
 *  3. Prefer names that share tokens with the game title.
 *  4. Break remaining ties by file size (game launchers are usually >1MB).
 *
 * Returns undefined if no plausible candidate exists; the caller should then
 * surface the "set the target executable" dialog.
 */
export function findGameExecutable(
  installPath: string,
  title?: string
): string | undefined {
  if (!existsSync(installPath)) {
    logError(
      `findGameExecutable: install path does not exist: ${installPath}`,
      LogPrefix.Humble
    )
    return undefined
  }

  const candidates: ExeCandidate[] = []
  walkExes(installPath, candidates)

  if (!candidates.length) {
    logError(
      `findGameExecutable: zero .exe files found under ${installPath} — install probably failed`,
      LogPrefix.Humble
    )
    return undefined
  }

  const filtered = candidates.filter((c) => isLikelyGameExe(c.path))
  if (!filtered.length) {
    logError(
      [
        `findGameExecutable: all candidates filtered out for ${installPath} —`,
        candidates.map((c) => basename(c.path)).join(', ')
      ],
      LogPrefix.Humble
    )
    return undefined
  }

  const titleTokens = title ? tokensFromTitle(title) : []
  const scored = filtered.map((c) => {
    const lowerName = basename(c.path).toLowerCase()
    const tokenMatches = titleTokens.filter((tok) =>
      lowerName.includes(tok)
    ).length
    return {
      ...c,
      score:
        tokenMatches * 1000 - // strong preference for title-matching names
        c.depth * 10 + // shallower is better
        Math.min(c.size / 1_000_000, 50) // bigger up to 50MB tiebreak
    }
  })

  scored.sort((a, b) => b.score - a.score)
  logInfo(
    [
      `Picked ${scored[0].path} from ${scored.length} candidate(s):`,
      scored
        .map((s) => `${basename(s.path)}(score=${s.score.toFixed(1)})`)
        .join(', ')
    ],
    LogPrefix.Humble
  )
  return scored[0].path
}
