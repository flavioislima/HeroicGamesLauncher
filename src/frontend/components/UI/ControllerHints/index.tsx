import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import ContextProvider from 'frontend/state/ContextProvider'

import './index.css'

export default function ControllerHints() {
  const { activeController } = useContext(ContextProvider)
  const [layout, setLayout] = useState('steam-deck') // default to steam deck icons
  const [mainActionHint, setMainActionHint] = useState('') // A / Cross
  const [altActionHint, setAltActionHint] = useState('') // X / Square
  const [altActionHint2, setAltActionHint2] = useState('') // Y / Triangle
  const [backActionHint, setBackActionHint] = useState('') // B / Circle
  const [backActionFallback, setBackActionFallback] = useState('')

  const location = useLocation()
  const { t } = useTranslation()

  // set hints for an element
  const setHintsFor = (target: HTMLElement) => {
    const classes = target.classList

    let main = t('controller.hints.select', 'Select')
    let alt = ''
    let alt2 = ''
    let back = ''

    const card = target.closest('.gameCard')
    const list = target.closest('.gameListItem')
    const installDialog = target.closest('.InstallModal__dialog')

    if (card || list) {
      // focusing a card/list item or an icon inside a card/list item
      alt = t('controller.hints.options', 'Options')
      if (classes.contains('updateIcon')) {
        main = t('controller.hints.update_game', 'Update game')
      } else if (classes.contains('settingsIcon')) {
        main = t('controller.hints.game_settings', 'Game settings')
      } else if (classes.contains('playIcon')) {
        main = t('controller.hints.play_game', 'Play game')
      } else if (classes.contains('downIcon')) {
        main = t('controller.hints.install_game', 'Install game')
      } else if (
        card?.classList.contains('installed') ||
        list?.classList.contains('installed')
      ) {
        main = t('controller.hints.game_details', 'Game details')
        alt2 = t('controller.hints.play_game', 'Play game')
      } else {
        main = t('controller.hints.game_details', 'Game details')
        alt2 = t('controller.hints.install_game', 'Install game')
      }
    } else if (target.id === 'search') {
      // focusing the search bar
      main = t(
        'controller.hints.open_virtual_keyboard',
        'Open virtual keyboard'
      )
    } else if (target.closest('.contextMenu')) {
      // focusing a context menu on a card or list item
      main = t('controller.hints.select', 'Select')
      back = t('controller.hints.back', 'Back')
      alt = t('controller.hints.close_options', 'Close options')
    } else if (classes.contains('hg-button')) {
      // focusing a virtual keyboard element
      main = t('controller.hints.select', 'Select')
      back = t('controller.hints.close_keyboard', 'Close keyboard')
      alt = t('controller.hints.backspace', 'Backspace')
      alt2 = t('controller.hints.space', 'Space')
    } else if (installDialog) {
      back = t('controller.hints.close_dialog', 'Close dialog')
    } else if (target.closest('.MuiList-root')) {
      main = t('controller.hints.select', 'Select')
      back = t('controller.hints.close_options', 'Close options')
    }

    setMainActionHint(main)
    setAltActionHint(alt)
    setAltActionHint2(alt2)
    setBackActionHint(back)
  }

  // proxy method to set hints depending on what's focused
  const setHints = (target: HTMLElement | null | typeof globalThis) => {
    // sometimes focus can be null or the window object
    if (!target || target === globalThis) {
      setMainActionHint('')
      setAltActionHint('')
      setAltActionHint2('')
      setBackActionHint('')
      return
    }

    setHintsFor(target as HTMLElement)
  }

  // listen to `controller-changed` custom events to set the controller brand
  // listen to `focus` events to detect the current focused element
  useEffect(() => {
    const onFocusChanged = (e: FocusEvent) => {
      const tgt = !e.target ? null : (e.target as HTMLElement)
      setHints(tgt)
    }

    window.addEventListener('focus', onFocusChanged, true)

    return () => {
      window.removeEventListener('focus', onFocusChanged)
    }
  }, [])

  useEffect(() => {
    // check if there's any page to go back
    if (history?.state?.idx === 0) {
      setBackActionFallback('')
    } else {
      setBackActionFallback(t('controller.hints.back', 'Back'))
    }

    // check focused element after a page change
    setHints(document.querySelector<HTMLElement>(':focus'))
  }, [location])

  useEffect(() => {
    // set the brand for the images to use
    if (activeController.match(/054c.*0ce6/i)) {
      setLayout('ps5')
    } else if (
      activeController.match(/054c|PS3|054c.*09cc|0268|'2563.*0523/i)
    ) {
      setLayout('ps4')
    } else if (activeController.match(/28de.*11ff/)) {
      setLayout('steam-deck')
    } else if (activeController.match(/microsoft|xbox/i)) {
      setLayout('xbox')
    } else {
      setLayout('steam-deck')
    }
  }, [activeController])

  // empty if no controller activated
  if (!activeController) {
    return <></>
  }

  return (
    <div className={`controller-hints ${layout}`}>
      <div className="hint">
        <i className="buttonImage main-action" />
        {mainActionHint || '–'}
      </div>
      <div className="hint">
        <i className="buttonImage back" />
        {backActionHint || backActionFallback || '–'}
      </div>
      <div className="hint">
        <i className="buttonImage alt-action" />
        {altActionHint || '–'}
      </div>
      <div className="hint">
        <i className="buttonImage alt-action2" />
        {altActionHint2 || '–'}
      </div>
      <div className="hint">
        <i className="buttonImage d-pad" />
        <i className="buttonImage left-stick" />
        {t('controller.hints.move_cursor', 'Move cursor')}
      </div>
      <div className="hint">
        <i className="buttonImage right-stick" />
        {t('controller.hints.scroll', 'Scroll')}
      </div>
    </div>
  )
}
