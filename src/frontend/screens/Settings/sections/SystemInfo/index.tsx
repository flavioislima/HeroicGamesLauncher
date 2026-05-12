import { useTranslation } from 'react-i18next'

import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import { StyledEngineProvider } from '@mui/material/styles'

import { useAwaited } from 'frontend/hooks/useAwaited'

import SteamDeckLogo from 'frontend/assets/steam-deck-logo.svg?react'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

import CPUCard from './cpu'
import MemoryProgress from './memory'
import GPUCard from './gpu'
import OSInfo from './os'
import SoftwareInfo from './software'

import './index.scss'

import type { SystemInformation } from 'backend/utils/systeminfo'

interface SystemSpecificationsProps {
  systemInformation: SystemInformation
}

function SystemSpecifications({
  systemInformation
}: SystemSpecificationsProps) {
  return (
    <Grid container spacing={1}>
      <Grid item xs={6}>
        <CPUCard cpu={systemInformation.CPU} />
      </Grid>
      <Grid item xs={6}>
        <MemoryProgress memory={systemInformation.memory} />
      </Grid>
      {...systemInformation.GPUs.map((gpu, index) => (
        <Grid key={index} item xs={6}>
          <GPUCard
            gpu={gpu}
            gpuNumber={index}
            showNumber={systemInformation.GPUs.length !== 1}
          />
        </Grid>
      ))}
    </Grid>
  )
}

function SteamDeckSystemSpecifications({
  systemInformation
}: SystemSpecificationsProps) {
  const { t } = useTranslation()

  return (
    <>
      <Paper sx={{ width: '50%' }} square>
        <Typography variant="h6">
          {t('settings.systemInformation.systemModel', 'System Model:')}
        </Typography>
        <Grid container>
          <Grid item xs={2}>
            <SteamDeckLogo className="logo fillWithThemeColor" />
          </Grid>
          <Grid item xs={10}>
            {t('settings.systemInformation.steamDeck', 'Steam Deck {{model}}', {
              model: systemInformation.steamDeckInfo.model
            })}
          </Grid>
        </Grid>
      </Paper>
      <details>
        <summary className="showSystemSpecifications">
          {t(
            'settings.systemInformation.showDetailed',
            'Show detailed system specifications'
          )}
        </summary>
        <SystemSpecifications systemInformation={systemInformation} />
      </details>
    </>
  )
}

export default function SystemInfo() {
  const { t } = useTranslation()

  const systemInformation = useAwaited(async () =>
    window.api.systemInfo.get(false)
  )
  if (!systemInformation) return <CircularProgress />

  return (
    <StyledEngineProvider injectFirst>
      <Box sx={{ width: '770px', textAlign: 'start' }} className="systeminfo">
        <h3>{t('settings.navbar.systemInformation', 'System Information')}</h3>
        <h5>
          {t(
            'settings.systemInformation.systemSpecifications',
            'System Specifications:'
          )}
        </h5>
        {systemInformation.steamDeckInfo.isDeck ? (
          <SteamDeckSystemSpecifications
            systemInformation={systemInformation}
          />
        ) : (
          <SystemSpecifications systemInformation={systemInformation} />
        )}
        <hr />
        <Grid container spacing={1}>
          <Grid item xs={6}>
            <OSInfo
              os={systemInformation.OS}
              isFlatpak={systemInformation.isFlatpak}
            />
          </Grid>
          <Grid item xs={6}>
            <SoftwareInfo software={systemInformation.softwareInUse} />
          </Grid>
        </Grid>
        <Button
          className="copyToClipboardButton button is-primary"
          variant="contained"
          startIcon={<ContentCopyIcon />}
          onClick={() => window.api.systemInfo.copyToClipboard()}
        >
          {t('settings.systemInformation.copyToClipboard', 'Copy to clipboard')}
        </Button>
      </Box>
    </StyledEngineProvider>
  )
}
