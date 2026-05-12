import { useContext, useEffect, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import LinkIcon from '@mui/icons-material/Link'
import PublicIcon from '@mui/icons-material/Public'
import { Autorenew } from '@mui/icons-material'
import { Button, Paper, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') backdropClick()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [backdropClick])

  const { loading, error } = status

  const handleCopyLink = () => {
    window.api.clipboardWriteText(apiKeysUrl)
    setLinkCopied(true)
  }

  const handleOpen = () => {
    window.api.openExternalUrl(apiKeysUrl)
  }

  const handleLogin = async (apiKey: string) => {
    if (apiKey.trim().length < 20) return
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

  const handlePasteAndLogin = async () => {
    const text = await window.api.clipboardReadText()
    setInput(text)
    await handleLogin(text)
  }

  function getButtonLabel() {
    if (loading) return t('button.loading', 'Loading')
    if (error) return t('button.itchio_error', 'Error, try a different API key')
    return t('button.login', 'Login')
  }

  return (
    <div className="SIDLoginModal" role="dialog" aria-modal="true">
      <span className="backdrop" onClick={backdropClick}></span>
      <div className="sid-modal">
        <button
          className="sid-modal__close"
          onClick={backdropClick}
          aria-label={t('button.close', 'Close')}
          type="button"
        >
          <CloseIcon fontSize="small" />
        </button>
        <div className="loginInstructions">
          <strong>{t('welcome', 'Welcome!')}</strong>
          <p>
            {t(
              'itchio.instructions',
              'itch.io desktop integration uses a personal API key. Visit your itch.io API keys page, generate a key, and paste it below.'
            )}
          </p>
        </div>
        <Paper variant="outlined" className="login-link">
          <Typography variant="subtitle1">{apiKeysUrl}</Typography>
          <Stack direction="row" spacing={1}>
            <Button
              className={linkCopied ? 'icon-button-success' : 'icon-button'}
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
        <div className="sid-input-wrapper">
          <input
            id="itchio-api-key-input"
            type="password"
            className="sid-input"
            value={input}
            onAuxClick={async () => {
              const text = await window.api.clipboardReadText()
              setInput(text)
            }}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleLogin(input)
            }}
            placeholder={t('itchio.api_key_placeholder', 'Paste your API key')}
            autoFocus
            disabled={loading}
          />
          <button
            type="button"
            className="sid-input-action"
            onClick={handlePasteAndLogin}
            disabled={loading}
            aria-label={t(
              'itchio.paste_and_login',
              'Paste from clipboard and log in'
            )}
            title={t(
              'itchio.paste_and_login',
              'Paste from clipboard and log in'
            )}
          >
            <ContentPasteIcon fontSize="small" />
          </button>
        </div>
        <p className="message">
          {loading && <Autorenew className="material-icons refreshing" />}
        </p>
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
