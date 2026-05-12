import './index.scss'

import React, { useContext, useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'
import {
  AdvertiseAvxForRosetta,
  AlternativeExe,
  AutoDXVK,
  AutoDXVKNVAPI,
  AutoVKD3D,
  BattlEyeRuntime,
  CrossoverBottle,
  EacRuntime,
  EnableEsync,
  EnableFSR,
  EnableFsync,
  EnableMsync,
  EnableWineWayland,
  EnableWoW64,
  EnvVariablesTable,
  GameMode,
  LauncherArgs,
  LaunchOptionSelector,
  Mangohud,
  OfflineMode,
  PreferedLanguage,
  PreferSystemLibs,
  ShowFPS,
  SteamRuntime,
  WinePrefix,
  WineVersionSelector,
  WrappersTable,
  EnableDXVKFpsLimit,
  IgnoreGameUpdates,
  Gamescope,
  BeforeLaunchScriptPath,
  AfterLaunchScriptPath,
  NvidiaPrime
} from '../../components'
import { TabPanel } from 'frontend/components/UI'
import ContextProvider from 'frontend/state/ContextProvider'
import Tools from '../../components/Tools'
import SettingsContext from '../../SettingsContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons'
import useSetting from 'frontend/hooks/useSetting'
import { defaultWineVersion } from '../..'
import SyncSaves from '../SyncSaves'
import FooterInfo from '../FooterInfo'
import { Tabs, Tab } from '@mui/material'
import { GameInfo } from 'common/types'
import DisableUMU from '../../components/DisableUMU'
import VerboseLogs from '../../components/VerboseLogs'

const windowsPlatforms = ['Win32', 'Windows', 'windows']
function getStartingTab(platform: string, gameInfo?: GameInfo | null): string {
  if (!gameInfo) {
    if (platform !== 'win32') {
      return 'wine'
    }
    return 'advanced'
  }
  if (platform === 'win32') {
    return 'advanced'
  } else if (windowsPlatforms.includes(gameInfo?.install.platform || '')) {
    return 'wine'
  } else if (platform === 'darwin') {
    return 'advanced'
  } else {
    return 'other'
  }
}

export default function GamesSettings() {
  const { t } = useTranslation()
  const { platform } = useContext(ContextProvider)
  const { isDefault, gameInfo } = useContext(SettingsContext)
  const [wineVersion] = useSetting('wineVersion', defaultWineVersion)
  const [isNative, setIsNative] = useState(false)
  const isLinux = platform === 'linux'
  const isWin = platform === 'win32'
  const isMac = platform === 'darwin'
  const isCrossover = wineVersion?.type === 'crossover'
  const showCloudSavesTab =
    gameInfo?.runner === 'gog' || gameInfo?.runner === 'legendary'
  const isBrowserGame = gameInfo?.install.platform === 'Browser'
  const isSideloaded = gameInfo?.runner === 'sideload'

  function shouldShowSettings(tab: 'wine' | 'other'): boolean {
    if (tab === 'wine') {
      if (isWin || isNative || isBrowserGame) {
        return false
      }
      return true
    }

    // Other tab show on linux and mac (if not native)
    if (isLinux || (isMac && !isNative)) {
      return true
    }
    return false
  }
  // Get the latest used tab index for the current game
  const localStorageKey = gameInfo
    ? `${gameInfo.app_name}-setting_tab`
    : 'default'
  const latestTabIndex =
    localStorage.getItem(localStorageKey) || getStartingTab(platform, gameInfo)
  const [value, setValue] = useState(latestTabIndex)

  const handleChange = (
    event: React.ChangeEvent<unknown>,
    newValue: string
  ) => {
    setValue(newValue)
    // Store the latest used tab index for the current game
    localStorage.setItem(localStorageKey, newValue.toString())
  }

  useEffect(() => {
    if (gameInfo) {
      const getIsNative = async () => {
        const isNative = await window.api.isNative({
          appName: gameInfo?.app_name,
          runner: gameInfo?.runner
        })
        setIsNative(isNative)
      }
      void getIsNative()
    }
  }, [gameInfo])

  const showOtherTab = shouldShowSettings('other')
  const showWineTab = shouldShowSettings('wine')

  return (
    <>
      {isDefault && (
        <p className="defaults-hint">
          <FontAwesomeIcon icon={faInfoCircle} />
          {t(
            'settings.default_hint',
            'Changes in this section only apply as default values when installing games. If you want to change the settings of an already installed game, use the Settings button in the game page.'
          )}
        </p>
      )}

      <Tabs
        value={value}
        onChange={handleChange}
        aria-label="settings tabs"
        variant="scrollable"
      >
        {showWineTab && <Tab label="Wine" value="wine" />}
        {showOtherTab && (
          <Tab label={t('settings.navbar.other', 'Other')} value="other" />
        )}
        <Tab
          label={t('settings.navbar.advanced', 'Advanced')}
          value="advanced"
        />

        {showCloudSavesTab && (
          <Tab
            label={t('settings.navbar.sync', 'Cloud Saves Sync')}
            value="saves"
          />
        )}
        {isLinux && (
          <Tab
            label={t('settings.navbar.gamescope', 'Gamescope')}
            value="gamescope"
          />
        )}
        {isLinux && !isNative && (
          <Tab label={t('settings.navbar.legacy', 'Legacy')} value="legacy" />
        )}
      </Tabs>

      <TabPanel value={value} index={'wine'}>
        <WineVersionSelector />
        <WinePrefix />
        <CrossoverBottle />
        {!isCrossover && (
          <>
            <AutoDXVK />
            {isLinux && (
              <>
                {!window.isSteamDeck && <AutoDXVKNVAPI />}
                <AutoVKD3D />
              </>
            )}
            <EnableEsync />
            <EnableFsync />
            <EnableWineWayland />
            <EnableWoW64 />
            <EnableMsync />
            <AdvertiseAvxForRosetta />
            <EnableFSR />
            {isMac && <EnableDXVKFpsLimit />}
            <Tools />
          </>
        )}
      </TabPanel>

      <TabPanel value={value} index={'other'}>
        {!isNative && <ShowFPS />}
        <Mangohud />
        <GameMode />
        {isLinux && <PreferSystemLibs />}
        <SteamRuntime />
        <NvidiaPrime />
        {!isNative && (
          <>
            <BattlEyeRuntime />
            <EacRuntime />
          </>
        )}
      </TabPanel>

      <TabPanel value={value} index={'advanced'}>
        {!isSideloaded && (
          <>
            <IgnoreGameUpdates />
            <OfflineMode />
          </>
        )}
        <VerboseLogs />
        <DisableUMU />
        <AlternativeExe />
        <LaunchOptionSelector />
        <LauncherArgs />
        <div className="Field">
          <label>{t('setting.scripts', 'Scripts:')}</label>
          <BeforeLaunchScriptPath />
          <AfterLaunchScriptPath />
        </div>
        <WrappersTable />
        <EnvVariablesTable />
        {!isSideloaded && <PreferedLanguage />}
      </TabPanel>

      <TabPanel value={value} index={'saves'}>
        <SyncSaves />
      </TabPanel>

      <TabPanel value={value} index={'gamescope'}>
        <Gamescope />
      </TabPanel>

      {isLinux && (
        <TabPanel value={value} index={'legacy'}>
          <span className="defaults-hint">
            <FontAwesomeIcon icon={faInfoCircle} />
            {t(
              'settings.legacy_warning',
              'Warning: The settings on this tab are mostly deprecated and might not work at all.'
            )}
          </span>
          <EnableDXVKFpsLimit />
        </TabPanel>
      )}

      {!isDefault && <FooterInfo />}
    </>
  )
}
