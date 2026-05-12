import { createWriteStream } from 'fs'
import {
  chmod,
  stat,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir
} from 'fs/promises'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { finished } from 'stream/promises'

import extractZip from 'extract-zip'

import { setGlobalDispatcher, ProxyAgent } from 'undici'

type SupportedPlatform = 'win32' | 'darwin' | 'linux'
type DownloadedBinary =
  | 'legendary'
  | 'gogdl'
  | 'nile'
  | 'comet'
  | 'epic-integration'
  | 'butler'

const RELEASE_TAGS = {
  legendary: '0.20.43',
  gogdl: 'v1.2.1',
  nile: 'v1.1.2',
  comet: 'v0.2.0',
  'epic-integration': 'v0.4',
  // butler is distributed via itch.io's broth channel system rather than
  // GitHub releases; "LATEST" resolves the channel's newest version at
  // download time, but we pin a version here so reproducible builds get a
  // known butler and `.release_tags` invalidation works the same way as
  // for the other binaries.
  butler: '15.21.0'
} as const satisfies Record<DownloadedBinary, string>

const pathExists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  )

async function downloadFile(url: string, dst: string) {
  const response = await fetch(url, {
    keepalive: true,
    headers: {
      'User-Agent': 'HeroicBinaryUpdater/1.0'
    }
  })
  if (response.status !== 200) {
    throw Error(`Failed to download ${url}: ${response.status}`)
  }
  await mkdir(dirname(dst), { recursive: true })
  const fileStream = createWriteStream(dst, { flags: 'w' })
  await finished(Readable.fromWeb(response.body).pipe(fileStream))
}

async function downloadAsset(
  binaryName: string,
  repo: string,
  tag_name: string,
  arch: string,
  platform: SupportedPlatform,
  filename: string
) {
  const url = `https://github.com/${repo}/releases/download/${tag_name}/${filename}`
  console.log('Downloading', binaryName, 'for', platform, arch, 'from', url)

  const exeFilename = binaryName + (platform === 'win32' ? '.exe' : '')
  const exePath = join('public', 'bin', arch, platform, exeFilename)
  await downloadFile(url, exePath)

  console.log('Done downloading', binaryName, 'for', platform, arch)

  if (platform !== 'win32') {
    await chmod(exePath, '755')
  }
}

/**
 * Downloads assets uploaded to a GitHub release
 * @param binaryName The binary which was built & uploaded. Also used to get the final folder path
 * @param repo The repo to download from
 * @param tagName The GitHub Release tag which produced the binaries
 * @param assetNames The name(s) of the assets which were uploaded, mapped to platforms
 */
async function downloadGithubAssets(
  binaryName: string,
  repo: string,
  tagName: string,
  assetNames: Record<
    'x64' | 'arm64',
    Partial<Record<SupportedPlatform, string>>
  >
) {
  const downloadPromises = Object.entries(assetNames).map(
    async ([arch, platformFilenameMap]) =>
      Promise.all(
        Object.entries(platformFilenameMap).map(([platform, filename]) => {
          if (!filename) return
          return downloadAsset(
            binaryName,
            repo,
            tagName,
            arch,
            platform as keyof typeof platformFilenameMap,
            filename
          )
        })
      )
  )

  return Promise.all(downloadPromises)
}

async function downloadLegendary() {
  return downloadGithubAssets(
    'legendary',
    'Heroic-Games-Launcher/legendary',
    RELEASE_TAGS['legendary'],
    {
      x64: {
        linux: 'legendary_linux_x86_64',
        darwin: 'legendary_macOS_x86_64',
        win32: 'legendary_windows_x86_64.exe'
      },
      arm64: {
        linux: 'legendary_linux_arm64',
        darwin: 'legendary_macOS_arm64',
        win32: 'legendary_windows_arm64.exe'
      }
    }
  )
}

async function downloadGogdl() {
  return downloadGithubAssets(
    'gogdl',
    'Heroic-Games-Launcher/heroic-gogdl',
    RELEASE_TAGS['gogdl'],
    {
      x64: {
        linux: 'gogdl_linux_x86_64',
        darwin: 'gogdl_macOS_x86_64',
        win32: 'gogdl_windows_x86_64.exe'
      },
      arm64: {
        linux: 'gogdl_linux_arm64',
        darwin: 'gogdl_macOS_arm64',
        win32: 'gogdl_windows_arm64.exe'
      }
    }
  )
}

async function downloadNile() {
  return downloadGithubAssets('nile', 'imLinguin/nile', RELEASE_TAGS['nile'], {
    x64: {
      linux: 'nile_linux_x86_64',
      darwin: 'nile_macOS_x86_64',
      win32: 'nile_windows_x86_64.exe'
    },
    arm64: {
      linux: 'nile_linux_arm64',
      darwin: 'nile_macOS_arm64'
    }
  })
}

async function downloadComet() {
  return Promise.all([
    downloadGithubAssets(
      'GalaxyCommunication',
      'imLinguin/comet',
      RELEASE_TAGS['comet'],
      {
        x64: {
          win32: 'GalaxyCommunication-dummy.exe'
        },
        arm64: {}
      }
    ),
    downloadGithubAssets('comet', 'imLinguin/comet', RELEASE_TAGS['comet'], {
      x64: {
        linux: 'comet-x86_64-unknown-linux-gnu',
        darwin: 'comet-x86_64-apple-darwin',
        win32: 'comet-x86_64-pc-windows-msvc.exe'
      },
      arm64: {
        darwin: 'comet-aarch64-apple-darwin',
        linux: 'comet-aarch64-unknown-linux-gnu',
        win32: 'comet-aarch64-pc-windows-msvc.exe'
      }
    })
  ])
}

// butler ships in a zip with the binary plus a couple of sibling shared
// libraries (libc7zip, butler-runtime). We extract the whole zip into
// public/bin/<arch>/<platform>/ so butler can resolve those siblings at
// runtime; archSpecificBinary('butler') still resolves to the binary itself.
const BUTLER_CHANNELS: Record<
  'x64' | 'arm64',
  Partial<Record<SupportedPlatform, string>>
> = {
  x64: {
    linux: 'linux-amd64',
    darwin: 'darwin-amd64',
    win32: 'windows-amd64'
  },
  arm64: {
    darwin: 'darwin-arm64'
  }
}

async function downloadButlerForChannel(
  arch: 'x64' | 'arm64',
  platform: SupportedPlatform,
  channel: string,
  version: string
) {
  const url = `https://broth.itch.zone/butler/${channel}/${version}/archive/default`
  console.log('Downloading butler for', platform, arch, 'from', url)

  const tmpZip = join(
    tmpdir(),
    `heroic-butler-${arch}-${platform}-${process.pid}.zip`
  )
  await downloadFile(url, tmpZip)

  const destDir = join('public', 'bin', arch, platform)
  await mkdir(destDir, { recursive: true })
  // extract-zip writes into an existing directory; siblings from a previous
  // download stay put, which is fine since the same set of files just gets
  // overwritten.
  await extractZip(tmpZip, { dir: join(process.cwd(), destDir) })
  await rm(tmpZip, { force: true })

  if (platform !== 'win32') {
    const binPath = join(destDir, 'butler')
    await chmod(binPath, '755').catch(() =>
      console.warn(`butler binary not found after extract at ${binPath}`)
    )
    // Some butler releases ship the 7z native lib without an exec bit.
    // chmod everything that looks like a butler-shipped helper.
    for (const name of await readdir(destDir).catch(() => [])) {
      if (name.startsWith('butler') || name.includes('7z')) {
        await chmod(join(destDir, name), '755').catch(() => undefined)
      }
    }
  }
  console.log('Done downloading butler for', platform, arch)
}

async function downloadButler() {
  const promises: Promise<void>[] = []
  for (const [arch, byPlatform] of Object.entries(BUTLER_CHANNELS)) {
    for (const [platform, channel] of Object.entries(byPlatform)) {
      if (!channel) continue
      promises.push(
        downloadButlerForChannel(
          arch as 'x64' | 'arm64',
          platform as SupportedPlatform,
          channel,
          RELEASE_TAGS['butler']
        )
      )
    }
  }
  await Promise.all(promises)
}

async function downloadEpicIntegration() {
  return downloadGithubAssets(
    'EpicGamesLauncher',
    'Etaash-mathamsetty/heroic-epic-integration',
    RELEASE_TAGS['epic-integration'],
    {
      x64: {
        win32: 'EpicGamesLauncher.exe'
      },
      arm64: {}
    }
  )
}

/**
 * Finds out which binaries need to be downloaded by comparing
 * `public/bin/.release_tags` to RELEASE_TAGS
 */
async function compareDownloadedTags(): Promise<DownloadedBinary[]> {
  const storedTagsText = await readFile(
    'public/bin/.release_tags',
    'utf-8'
  ).catch(() => '{}')
  let storedTagsParsed: Partial<Record<DownloadedBinary, string>>
  try {
    storedTagsParsed = JSON.parse(storedTagsText)
  } catch {
    return ['legendary', 'gogdl', 'nile', 'comet', 'epic-integration', 'butler']
  }
  const binariesToDownload: DownloadedBinary[] = []
  for (const [runner, currentTag] of Object.entries(RELEASE_TAGS)) {
    if (storedTagsParsed[runner] !== currentTag)
      binariesToDownload.push(runner as keyof typeof RELEASE_TAGS)
  }
  return binariesToDownload
}

async function storeDownloadedTags() {
  await writeFile('public/bin/.release_tags', JSON.stringify(RELEASE_TAGS))
}

async function main() {
  const proxyUri = process.env['HTTPS_PROXY']
  if (proxyUri) {
    console.log(`Using proxy: ${proxyUri}`)
    const proxyAgent = new ProxyAgent(proxyUri)
    setGlobalDispatcher(proxyAgent)
  }

  if (!(await pathExists('public/bin'))) {
    console.error('public/bin not found, are you in the source root?')
    return
  }

  const binariesToDownload = await compareDownloadedTags()
  if (!binariesToDownload.length) {
    console.log('Nothing to download, binaries are up-to-date')
    return
  }

  console.log('Downloading:', binariesToDownload)
  const promisesToAwait: Promise<unknown>[] = []

  if (binariesToDownload.includes('legendary'))
    promisesToAwait.push(downloadLegendary())
  if (binariesToDownload.includes('gogdl'))
    promisesToAwait.push(downloadGogdl())
  if (binariesToDownload.includes('nile')) promisesToAwait.push(downloadNile())
  if (binariesToDownload.includes('comet'))
    promisesToAwait.push(downloadComet())
  if (binariesToDownload.includes('epic-integration'))
    promisesToAwait.push(downloadEpicIntegration())
  if (binariesToDownload.includes('butler'))
    promisesToAwait.push(downloadButler())

  await Promise.all(promisesToAwait)

  await storeDownloadedTags()
}

void main()
