import type { Runner } from 'common/types'

const LogPrefix = {
  General: '',
  Legendary: 'Legendary',
  Gog: 'Gog',
  Nile: 'Nile',
  Zoom: 'Zoom',
  Itchio: 'Itchio',
  WineDownloader: 'WineDownloader',
  ToolInstaller: 'ToolInstaller',
  GlobalConfig: 'GlobalConfig',
  GameConfig: 'GameConfig',
  ProtocolHandler: 'ProtocolHandler',
  Frontend: 'Frontend',
  Backend: 'Backend',
  Runtime: 'Runtime',
  Shortcuts: 'Shortcuts',
  WineTricks: 'Winetricks',
  Connection: 'Connection',
  DownloadManager: 'DownloadManager',
  ExtraGameInfo: 'ExtraGameInfo',
  Sideload: 'Sideload',
  LogUploader: 'LogUploader'
}
type LogPrefix = (typeof LogPrefix)[keyof typeof LogPrefix]

const MaxLogPrefixLength = Math.max(
  ...Object.values(LogPrefix).map((prefix) => prefix.length)
)

const RunnerToLogPrefixMap: Record<Runner, LogPrefix> = {
  legendary: LogPrefix.Legendary,
  gog: LogPrefix.Gog,
  nile: LogPrefix.Nile,
  sideload: LogPrefix.Sideload,
  zoom: LogPrefix.Zoom,
  itchio: LogPrefix.Itchio
}

const LogLevel = ['DEBUG', 'INFO', 'WARNING', 'ERROR'] as const
type LogLevel = (typeof LogLevel)[number]

const MaxLogLevelLength = Math.max(...LogLevel.map((level) => level.length))

export {
  LogPrefix,
  MaxLogPrefixLength,
  RunnerToLogPrefixMap,
  LogLevel,
  MaxLogLevelLength
}
