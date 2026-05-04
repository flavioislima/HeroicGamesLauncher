import axios from 'axios'
import { createHash } from 'crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  chmodSync
} from 'graceful-fs'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { LogPrefix, logError, logInfo, logWarning } from 'backend/logger'
import { isWindows, isMac } from 'backend/constants/environment'
import { runWineCommand } from 'backend/launcher'
import { extractFiles, spawnAsync } from 'backend/utils'
import { GameSettings } from 'common/types'

interface DownloadProgress {
  bytesDownloaded: number
  totalBytes: number
  percent: number
  speedBytesPerSecond: number
}

type ProgressCallback = (progress: DownloadProgress) => void

export async function downloadToTempFile(
  url: string,
  expectedMd5: string | undefined,
  abortSignal: AbortSignal | undefined,
  onProgress: ProgressCallback
): Promise<string> {
  const filename = basename(new URL(url).pathname) || 'humble-download'
  const tempPath = join(tmpdir(), `heroic-humble-${Date.now()}-${filename}`)
  const cleanup = () => {
    try {
      unlinkSync(tempPath)
    } catch {
      // ignore
    }
  }

  try {
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
      // Wait for `close` (fd released), not `finish` (data flushed). On
      // Windows, spawning the .exe while the writer's fd is still open
      // produces a sharing violation that surfaces as `spawn EACCES`.
      writer.on('close', () => resolve())
      writer.on('error', reject)
    })

    if (expectedMd5) {
      const actual = md5.digest('hex')
      if (actual.toLowerCase() !== expectedMd5.toLowerCase()) {
        cleanup()
        throw new Error(
          `Humble download MD5 mismatch (expected ${expectedMd5}, got ${actual})`
        )
      }
    }

    return tempPath
  } catch (error) {
    cleanup()
    throw error
  }
}

interface ExtractContext {
  appName: string
  archivePath: string
  installPath: string
  // Used to disambiguate the installed folder when an InnoSetup installer
  // ignores /DIR= and silently drops the game inside the Wine prefix.
  title?: string
  gameSettings?: GameSettings
}

export async function runInstaller(
  ctx: ExtractContext
): Promise<{ executable?: string }> {
  const ext = extname(ctx.archivePath).toLowerCase()
  mkdirSync(ctx.installPath, { recursive: true })

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
    const result = await extractFiles({
      path: ctx.archivePath,
      destination: ctx.installPath,
      strip: 0
    })
    if (result.status === 'error') {
      throw new Error(`tar extraction failed: ${result.error}`)
    }
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

async function runShellInstaller(
  ctx: ExtractContext
): Promise<{ executable?: string }> {
  if (isWindows) {
    throw new Error('Cannot run a .sh installer on Windows')
  }
  chmodSync(ctx.archivePath, 0o755)
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
    // Don't pass /SILENT here. Many Humble installers (Aquaria for instance)
    //  hard-code their target dir and silently install
    // somewhere other than `/DIR=`, leaving Heroic with an empty install
    // folder. Showing the installer UI lets the user pick the matching
    // folder; if they can't, the post-install warning shown by the frontend
    // tells them how to recover via "Change install path".
    const args = [`/DIR=${ctx.installPath}`, '/NOICONS']
    try {
      await runShell(ctx.archivePath, args)
    } catch (err) {
      // Inno Setup installers with a `requireAdministrator` manifest cause
      // CreateProcess to fail with ERROR_ELEVATION_REQUIRED, which libuv
      // surfaces as EACCES. Retry the launch through a UAC prompt.
      if ((err as NodeJS.ErrnoException).code !== 'EACCES') throw err
      logWarning(
        [
          `Installer for ${ctx.appName} requires elevation;`,
          'requesting UAC prompt'
        ],
        LogPrefix.Humble
      )
      await runWindowsInstallerElevated(ctx.archivePath, ctx.installPath)
    }
    return {}
  }
  if (isMac) {
    throw new Error(
      'Running .exe installers on macOS requires CrossOver or Wine; not yet supported'
    )
  }
  if (!ctx.gameSettings) {
    throw new Error('Wine settings missing for .exe install')
  }

  // Some Humble installers (Aquaria's is the common offender) hard-code
  // their `DefaultDirName` and ignore `/DIR=`, so the game ends up at e.g.
  // `<prefix>/drive_c/Program Files/Aquaria` and Heroic's chosen install
  // folder stays empty. Snapshot first so we can detect this and move it.
  const driveCPath = wineDriveCPath(ctx.gameSettings)
  const beforeSnapshot = snapshotInstallDirs(driveCPath)

  // Use the Wine-translated `Z:\` form for /DIR — most installers that
  // *do* honour /DIR insist on a Windows-style path with a drive letter.
  const wineDirArg = toWineZPath(ctx.installPath)
  const result = await runWineCommand({
    gameSettings: ctx.gameSettings,
    commandParts: [
      ctx.archivePath,
      '/SILENT',
      `/DIR=${wineDirArg}`,
      '/NOICONS'
    ],
    wait: true,
    protonVerb: 'run'
  })
  if (result.code && result.code !== 0) {
    throw new Error(`Wine installer exited with code ${result.code}`)
  }

  if (installPathHasContent(ctx.installPath)) {
    return {}
  }

  const afterSnapshot = snapshotInstallDirs(driveCPath)
  const candidate = pickGameInstallDir(beforeSnapshot, afterSnapshot, ctx.title)
  if (!candidate) {
    const newDirs = Array.from(afterSnapshot)
      .filter((p) => !beforeSnapshot.has(p))
      .map((p) => p)
    throw new Error(
      `Installer for ${ctx.appName} ignored /DIR= and we could not unambiguously identify the game folder. ` +
        `New directories under the Wine prefix: [${newDirs.join(', ')}]. ` +
        `Move the right one to ${ctx.installPath} manually.`
    )
  }
  logWarning(
    [
      `Installer ignored /DIR= for ${ctx.appName}; game landed at ${candidate}`,
      `— moving to ${ctx.installPath}`
    ],
    LogPrefix.Humble
  )
  await moveDirIntoPlace(candidate, ctx.installPath)
  logInfo(
    [`Moved ${ctx.appName} from ${candidate} to ${ctx.installPath}`],
    LogPrefix.Humble
  )
  return {}
}

async function runWindowsInstallerElevated(
  exe: string,
  installPath: string
): Promise<void> {
  // Build the Inno Setup command line as one string so paths with spaces
  // survive intact through PowerShell -> ShellExecuteEx -> the installer.
  // No /SILENT here: we want the installer wizard so the user can pick the
  // matching install folder (see the Windows branch of runWindowsInstaller).
  const cmdLine = `/DIR="${installPath}" /NOICONS`
  // Single-quoted strings in PowerShell are literal; escape embedded
  // single quotes by doubling them.
  const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`
  const psCmd =
    `$p = Start-Process -FilePath ${psQuote(exe)} ` +
    `-ArgumentList ${psQuote(cmdLine)} -Verb RunAs -Wait -PassThru; ` +
    `exit $p.ExitCode`
  await runShell('powershell.exe', ['-NoProfile', '-Command', psCmd])
}

// Wine maps the Z: drive to the Linux root by default, so any Linux
// path can be reached as `Z:\some\absolute\path`. InnoSetup parses
// `/DIR=` strictly and rejects `/home/...` style values.
function toWineZPath(linuxPath: string): string {
  const trimmed = linuxPath.replace(/^\/+/, '')
  return 'Z:\\' + trimmed.replace(/\//g, '\\')
}

function wineDriveCPath(gameSettings: GameSettings): string {
  const isProton = gameSettings.wineVersion?.type === 'proton'
  return isProton
    ? join(gameSettings.winePrefix, 'pfx', 'drive_c')
    : join(gameSettings.winePrefix, 'drive_c')
}

const PREFIX_INSTALL_ROOTS = ['Program Files', 'Program Files (x86)', 'Games']

// Wine populates these the first time *any* installer runs against a
// fresh prefix (MS shared DLLs, IE/Windows folders, etc.) — they look
// like brand-new dirs in the snapshot diff but are never the game.
const SYSTEM_DIR_PATTERNS: RegExp[] = [
  /^common files( |$)/i,
  /^internet explorer$/i,
  /^windows( |$)/i,
  /^windowsapps$/i,
  /^windowspowershell$/i,
  /^microsoft( |\.|$)/i,
  /^reference assemblies$/i,
  /^uninstall information$/i,
  /^msbuild$/i
]

function isSystemDirName(name: string): boolean {
  return SYSTEM_DIR_PATTERNS.some((re) => re.test(name))
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dirNameMatchesTitle(dirName: string, title: string): boolean {
  const a = normalizeForMatch(dirName)
  const b = normalizeForMatch(title)
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const tokens = b.split(' ').filter((t) => t.length > 2)
  return tokens.some((tok) => a.includes(tok))
}

function dirContainsLikelyGameExe(dir: string): boolean {
  const candidates: ExeCandidate[] = []
  walkExes(dir, candidates, 0, 3)
  return candidates.some((c) => isLikelyGameExe(c.path))
}

function snapshotInstallDirs(driveCPath: string): Set<string> {
  const result = new Set<string>()
  for (const root of PREFIX_INSTALL_ROOTS) {
    const full = join(driveCPath, root)
    if (!existsSync(full)) continue
    let entries: string[]
    try {
      entries = readdirSync(full)
    } catch {
      continue
    }
    for (const entry of entries) {
      const sub = join(full, entry)
      try {
        if (statSync(sub).isDirectory()) result.add(sub)
      } catch {
        // ignore stale symlinks etc.
      }
    }
  }
  return result
}

function pickGameInstallDir(
  before: Set<string>,
  after: Set<string>,
  title?: string
): string | undefined {
  const newDirs: string[] = []
  for (const path of after) {
    if (!before.has(path)) newDirs.push(path)
  }
  if (!newDirs.length) return undefined

  // Drop Wine's auto-created system dirs — confusing one of them (Common
  // Files, Internet Explorer, Microsoft.NET) for the game folder is
  // exactly the bug we're guarding against.
  const filtered = newDirs.filter((p) => !isSystemDirName(basename(p)))
  if (!filtered.length) return undefined

  const withGameExe = filtered.filter(dirContainsLikelyGameExe)
  const candidates = withGameExe.length ? withGameExe : filtered

  if (title) {
    const titleMatched = candidates.find((p) =>
      dirNameMatchesTitle(basename(p), title)
    )
    if (titleMatched) return titleMatched
  }

  if (candidates.length === 1) return candidates[0]

  // Ambiguous: refuse to guess and let the user resolve manually.
  return undefined
}

function installPathHasContent(installPath: string): boolean {
  try {
    return readdirSync(installPath).length > 0
  } catch {
    return false
  }
}

// EXDEV fallback uses cp -a since renameSync can't cross filesystems.
async function moveDirIntoPlace(src: string, dest: string) {
  try {
    rmSync(dest, { recursive: true, force: true })
    renameSync(src, dest)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }
  mkdirSync(dest, { recursive: true })
  const { code, stderr } = await spawnAsync('cp', ['-a', `${src}/.`, dest])
  if (code !== 0) {
    throw new Error(`cp -a ${src}/. ${dest} failed: ${stderr || code}`)
  }
  rmSync(src, { recursive: true, force: true })
}

async function runShell(cmd: string, args: string[]): Promise<void> {
  logInfo(['Running:', cmd, args.join(' ')], LogPrefix.Humble)
  const { code, stderr } = await spawnAsync(cmd, args, { stdio: 'inherit' })
  if (code !== 0) {
    logError([cmd, 'exited with code', `${code}`], LogPrefix.Humble)
    throw new Error(
      `${cmd} exited with code ${code}${stderr ? `: ${stderr}` : ''}`
    )
  }
}

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
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip dependency folders entirely — saves a lot of stat calls on
      // Unreal/Unity titles that ship full _CommonRedist trees.
      if (DIR_BLOCKLIST.includes(entry.name.toLowerCase())) continue
      walkExes(full, out, depth + 1, maxDepth)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
      try {
        out.push({ path: full, size: statSync(full).size, depth })
      } catch {
        // ignore stale symlinks etc.
      }
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
