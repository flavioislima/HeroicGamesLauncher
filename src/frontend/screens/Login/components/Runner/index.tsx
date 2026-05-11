import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import './index.css'

interface RunnerProps {
  loginUrl: string
  class: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any
  isLoggedIn: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logoutAction: () => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loginAction?: () => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  alternativeLoginAction?: () => any
  buttonText: string
  disabled: boolean
}

export default function Runner(props: RunnerProps) {
  const maxNameLength = 20
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  async function handleLogout() {
    setIsLoggingOut(true)
    await props.logoutAction()
    // FIXME: only delete local storage relate to one store, or only delete if logged out from both
    //window.localStorage.clear()
    setIsLoggingOut(false)
  }

  function handleLogin() {
    if (props.disabled) {
      return
    }

    if (props.loginAction) {
      props.loginAction()
      return
    }

    navigate(props.loginUrl)
  }

  function handleAltLogin() {
    if (props.disabled || !props.alternativeLoginAction) {
      return
    }

    props.alternativeLoginAction()
  }

  return (
    <>
      <div
        className={`runnerWrapper ${props.class} ${
          props.disabled ? 'disabled' : ''
        }`}
      >
        <div className={`runnerIcon ${props.class}`}>{props.icon()}</div>
        {props.isLoggedIn && (
          <div className="userData">
            <span>
              {String(props.user).slice(0, maxNameLength) +
                (String(props.user).length > maxNameLength ? '...' : '')}
            </span>
          </div>
        )}
        <div className="runnerButtons">
          {!props.isLoggedIn ? (
            <div className="runnerLogin" onClick={() => handleLogin()}>
              {props.buttonText}
            </div>
          ) : isLoggingOut ? (
            <div className="runnerLogin logged">
              {t('userselector.logging_out', 'Logging out')}...
            </div>
          ) : (
            <div
              className="runnerLogin logged"
              onClick={() => {
                handleLogout()
              }}
            >
              {t('userselector.logout', 'Logout')}
            </div>
          )}
        </div>
      </div>
      {props.alternativeLoginAction && !props.isLoggedIn && (
        <div className={`runnerWrapper ${props.disabled ? 'disabled' : ''}`}>
          <div className="runnerIcon alternative">{props.icon()}</div>
          <div className="runnerButtons">
            <div
              onClick={() => handleAltLogin()}
              className="runnerLogin alternative"
            >
              {`${props.class} ${t(
                'login.alternative_method',
                'Alternative Login Method'
              )}`}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
