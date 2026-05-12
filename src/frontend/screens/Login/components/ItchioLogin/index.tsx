import { useContext, useEffect, useState } from 'react'
import Info from '@mui/icons-material/Info'
import LinkIcon from '@mui/icons-material/Link'
import PublicIcon from '@mui/icons-material/Public'
import { Button, Paper, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Autorenew } from '@mui/icons-material'

import ContextProvider from 'frontend/state/ContextProvider'
import '../SIDLogin/index.css'

interface Props {
  backdropClick: () => void
}

export default function ItchioLogin({ backdropClick }: Props) {
  const { itchio } = useContext(ContextProvider)
  const { t } = useTranslation('login')

  const [apiKeysUrl, setApiKeysUrl] = useState(
    'https://itch.io/user/settings/api-keys'
  )
  const [input, setInput] = useState('')
  const [status, setStatus] = useState({ loading: false, error: false })
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    itchio.getLoginData().then((data) => {
      if (data.apiKeysUrl) setApiKeysUrl(data.apiKeysUrl)
    })
  }, [itchio])

  const { loading, error } = status

  const handleCopyLink = () => {
    window.api.clipboardWriteText(apiKeysUrl)
    setLinkCopied(true)
  }

  const handleOpen = () => {
    window.api.openExternalUrl(apiKeysUrl)
  }

  const handleLogin = async (apiKey: string) => {
    window.api.logInfo('Called itch.io Login')
    setStatus({ loading: true, error: false })
    const res = await itchio.login({ apiKey: apiKey.trim() })
    if (res === 'done') {
      setStatus({ loading: false, error: false })
      backdropClick()
    } else {
      setStatus({ loading: false, error: true })
      setTimeout(() => setStatus({ loading: false, error: false }), 2500)
    }
  }

  function getButtonLabel() {
    if (loading) return t('button.loading', 'Loading')
    if (error) return t('button.itchio_error', 'Error, try a different API key')
    return t('button.login', 'Login')
  }

  return (
    <div className="SIDLoginModal">
      <span className="backdrop" onClick={backdropClick}></span>
      <div className="sid-modal">
        <div className="loginInstructions">
          <strong>{t('welcome', 'Welcome!')}</strong>
          <p>
            {t(
              'itchio.instructions',
              'itch.io desktop integration uses a personal API key. Visit your itch.io API keys page, generate a key, and paste it below.'
            )}
          </p>
          <ol>
            <li>
              <Paper variant="outlined" className="login-link">
                <Typography variant="subtitle1" paddingLeft={2}>
                  {apiKeysUrl}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                    className={
                      linkCopied ? 'icon-button-success' : 'icon-button'
                    }
                    onClick={handleCopyLink}
                    endIcon={<LinkIcon fontSize="small" />}
                    variant="outlined"
                    size="small"
                  >
                    {linkCopied ? t('button.copied') : t('button.copy')}
                  </Button>
                  <Button
                    className="icon-button"
                    endIcon={<PublicIcon fontSize="small" />}
                    onClick={handleOpen}
                    size="small"
                    variant="outlined"
                  >
                    {t('button.open')}
                  </Button>
                </Stack>
              </Paper>
            </li>
            <li>
              {t(
                'itchio.paste_key',
                'Paste the API key into the field below and click Login.'
              )}
              <Info style={{ marginLeft: '4px' }} className="material-icons" />
            </li>
          </ol>
        </div>
        <input
          type="text"
          className="sid-input"
          value={input}
          onAuxClick={async () => {
            const text = await window.api.clipboardReadText()
            setInput(text)
          }}
          onChange={(e) => setInput(e.target.value)}
          placeholder="itch.io API key"
        />
        {loading && (
          <p className="message">
            <Autorenew className="material-icons refreshing" />{' '}
          </p>
        )}
        <button
          onClick={async () => handleLogin(input)}
          className="button is-primary"
          disabled={loading || input.trim().length < 20 || error}
        >
          {getButtonLabel()}
        </button>
      </div>
    </div>
  )
}
