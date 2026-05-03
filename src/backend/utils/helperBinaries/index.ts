import { runRunnerCommand as runLegendaryCommand } from '../../storeManagers/legendary/library'
import { runRunnerCommand as runGogdlCommand } from '../../storeManagers/gog/library'
import { runRunnerCommand as runNileCommand } from '../../storeManagers/nile/library'
import { runRunnerCommand as runEACommand } from '../../storeManagers/ea/library'
import { spawnSync } from 'node:child_process'
import { getCometBin } from 'backend/utils'
import { join } from 'path'

async function getLegendaryVersion(): Promise<string> {
  const { stdout, error, abort } = await runLegendaryCommand(
    {
      subcommand: undefined,
      '--version': true
    },
    {
      abortId: 'legendary-version'
    }
  )

  if (error ?? abort) return 'invalid'

  // Sample output:
  // legendary version "0.20.33", codename "Undue Alarm"
  // 1st capturing group matches the version, 2nd the codename
  const matches = stdout.match(/"([\d.]*)".*"(.*)"$/m)
  const version = matches?.[1]
  const codename = matches?.[2]
  if (!version || !codename) return 'invalid'
  return `${version} ${codename}`
}

async function getGogdlVersion(): Promise<string> {
  const { stdout, error } = await runGogdlCommand(['--version'], {
    abortId: 'gogdl-version'
  })

  if (error) return 'invalid'

  return stdout
}

async function getCometVersion(): Promise<string> {
  const path = getCometBin()
  const { stdout, error } = spawnSync(join(path.dir, path.bin), ['--version'])

  if (error) return 'invalid'

  return stdout.toString().trimEnd()
}

async function getNileVersion(): Promise<string> {
  const { stdout, error } = await runNileCommand(['--version'], {
    abortId: 'nile-version'
  })

  if (error) return 'invalid'

  return stdout
}

async function getEAVersion(): Promise<string> {
  const { stdout, error } = await runEACommand(['--version'], {
    abortId: 'ea-version'
  })

  if (error) return 'invalid'

  return stdout
}

export {
  getLegendaryVersion,
  getGogdlVersion,
  getNileVersion,
  getCometVersion,
  getEAVersion
}
