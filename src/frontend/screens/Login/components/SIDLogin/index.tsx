import { useContext, useEffect, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import Info from '@mui/icons-material/Info'
import LinkIcon from '@mui/icons-material/Link'
import PublicIcon from '@mui/icons-material/Public'
import { Button, Paper, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { loginPage, sidInfoPage } from 'frontend/helpers'
import './index.css'
import { Autorenew } from '@mui/icons-material'
import ContextProvider from 'frontend/state/ContextProvider'

interface Props {
  backdropClick: () => void
}

export default function SIDLogin({ backdropClick }: Props) {
  const epicLoginUrl = 'https://legendary.gl/epiclogin'

  const { epic } = useContext(ContextProvider)
  const { t } = useTranslation('login')
  const [input, setInput] = useState('')
  const [status, setStatus] = useState({
    loading: false,
    error: false
  })
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') backdropClick()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [backdropClick])

  const { loading, error } = status

  const handleCopyLink = () => {
    window.api.clipboardWriteText(epicLoginUrl)
    setLinkCopied(true)
  }

  const handleLogin = async (sid: string) => {
    if (sid.trim().length < 30) return
    window.api.logInfo('Called Epic Login')
    setStatus({
      loading: true,
      error: false
    })
    await epic.login(sid).then(async (res) => {
      console.log(res)
      if (res === 'done') {
        await window.api.getUserInfo()
        setStatus({ loading: false, error: false })
        backdropClick()
      } else {
        setStatus({
          loading: false,
          error: true
        })
        setTimeout(() => {
          setStatus({ loading: false, error: false })
        }, 2500)
      }
    })
  }

  const handlePasteAndLogin = async () => {
    const text = await window.api.clipboardReadText()
    setInput(text)
    await handleLogin(text)
  }

  function getButtonLabel() {
    if (loading) {
      return t('button.loading', 'Loading')
    } else if (error) {
      return t('button.error', 'Error, try a different Code')
    } else {
      return t('button.login', 'Login')
    }
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
              'message.part1',
              'In order for you to be able to log in and install your games, we first need you to follow the steps below:'
            )}
          </p>
          <ol>
            <li>
              {`${t('message.part2')} `}
              <span onClick={() => loginPage()} className="epicLink">
                {t('message.part3')}
              </span>
              {`${t('message.part4')} `}
              <span onClick={() => sidInfoPage()} className="sid">
                {`${t('message.part5')}`}
                <Info
                  style={{ marginLeft: '4px' }}
                  className="material-icons"
                />
              </span>
              <Paper variant="outlined" className="login-link">
                <Typography variant="subtitle1" paddingLeft={2}>
                  {epicLoginUrl}
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
                    onClick={() => loginPage()}
                    size="small"
                    variant="outlined"
                  >
                    {t('button.open')}
                  </Button>
                </Stack>
              </Paper>
            </li>
            <li>
              {`${t('message.part6')} `}
              <span onClick={() => sidInfoPage()} className="sid">
                {`${t('message.part7')}`}
              </span>
              {` ${t('message.part8')}`}
            </li>
          </ol>
        </div>
        <div className="sid-input-wrapper">
          <input
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
            placeholder={t('sid.placeholder', 'Paste SID code here')}
            autoFocus
            disabled={loading}
          />
          <button
            type="button"
            className="sid-input-action"
            onClick={handlePasteAndLogin}
            disabled={loading}
            aria-label={t(
              'sid.paste_and_login',
              'Paste from clipboard and log in'
            )}
            title={t('sid.paste_and_login', 'Paste from clipboard and log in')}
          >
            <ContentPasteIcon fontSize="small" />
          </button>
        </div>
        {loading && (
          <p className="message">
            <Autorenew className="material-icons refreshing" />{' '}
          </p>
        )}
        <button
          onClick={async () => handleLogin(input)}
          className="button is-primary"
          disabled={loading || input.length < 30 || error}
        >
          {getButtonLabel()}
        </button>
      </div>
    </div>
  )
}
