import axios from 'axios'
import { createHash } from 'crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
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
