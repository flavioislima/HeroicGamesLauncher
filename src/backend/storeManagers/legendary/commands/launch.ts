import type { Path } from 'backend/schemas'
import type { LegendaryAppName, NonEmptyString } from './base'

interface LaunchCommand {
  subcommand: 'launch'
  appName: LegendaryAppName
  extraArguments?: string
  '--offline'?: true
  '--skip-version-check'?: true
  '--override-username'?: NonEmptyString
  '--dry-run'?: true
  '--language'?: NonEmptyString
  '--wrapper'?: NonEmptyString
  '--set-defaults'?: true
  '--reset-defaults'?: true
  '--override-exe'?: Path
  '--origin'?: true
  '--ubisoft'?: true
  '--json'?: true
  '--wine'?: Path
  '--wine-prefix'?: Path
  '--no-wine'?: true
  '--crossover'?: true
  '--crossover-app'?: Path
  '--crossover-bottle'?: NonEmptyString
}

export default LaunchCommand
