import {
  AppSettings,
  GamepadActionStatus,
  ValidGamepadAction
} from 'common/types'
import {
  checkGameCube,
  checkPS3Clone1,
  checkStandard,
  checkN64Clone1,
  checkGenius1
} from './gamepad_layouts'
import { VirtualKeyboardController } from './virtualKeyboard'

const KEY_REPEAT_DELAY = 500
const STICK_REPEAT_DELAY = 250
const SCROLL_REPEAT_DELAY = 50

/*
 * For more documentation, check here https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/wiki/Gamepad-Navigation
 */

let controllerIsDisabled = false
let currentController = -1
let webviewHasFocus = false

export const toggleWebviewFocus = (focused: boolean) => {
  webviewHasFocus = focused
}

export const isUsingGamepad = () => currentController !== -1

export const initGamepad = () => {
  window.api.requestAppSettings().then(({ disableController }: AppSettings) => {
    controllerIsDisabled = disableController || false
  })

  // store the current controllers
  let controllers: number[] = []

  let isFocused = true
  window.addEventListener('focus', () => (isFocused = true))
  window.addEventListener('blur', () => (isFocused = false))

  // store the status and metadata for each action
  // triggeredAt is a hash with controllerIndex as keys and a timestamp or 0 (inactive)
  // this keeps track of the moment a button/trigger/stick is activated
  // we use this to know when to fire events
  const actions: GamepadActionStatus = {
    padUp: { triggeredAt: {}, repeatDelay: KEY_REPEAT_DELAY },
    padDown: { triggeredAt: {}, repeatDelay: KEY_REPEAT_DELAY },
    padLeft: { triggeredAt: {}, repeatDelay: KEY_REPEAT_DELAY },
    padRight: { triggeredAt: {}, repeatDelay: KEY_REPEAT_DELAY },
    leftStickUp: { triggeredAt: {}, repeatDelay: STICK_REPEAT_DELAY },
    leftStickDown: { triggeredAt: {}, repeatDelay: STICK_REPEAT_DELAY },
    leftStickLeft: { triggeredAt: {}, repeatDelay: STICK_REPEAT_DELAY },
    leftStickRight: { triggeredAt: {}, repeatDelay: STICK_REPEAT_DELAY },
    rightStickUp: { triggeredAt: {}, repeatDelay: SCROLL_REPEAT_DELAY },
    rightStickDown: { triggeredAt: {}, repeatDelay: SCROLL_REPEAT_DELAY },
    rightStickLeft: { triggeredAt: {}, repeatDelay: SCROLL_REPEAT_DELAY },
    rightStickRight: { triggeredAt: {}, repeatDelay: SCROLL_REPEAT_DELAY },
    mainAction: { triggeredAt: {}, repeatDelay: false },
    back: { triggeredAt: {}, repeatDelay: false },
    altAction: { triggeredAt: {}, repeatDelay: false },
    rightClick: { triggeredAt: {}, repeatDelay: false },
    leftClick: { triggeredAt: {}, repeatDelay: false },
    esc: { triggeredAt: {}, repeatDelay: false },
    tab: { triggeredAt: {}, repeatDelay: false },
    shiftTab: { triggeredAt: {}, repeatDelay: false },
    keyboardClick: { triggeredAt: {}, repeatDelay: false },
    guide: { triggeredAt: {}, repeatDelay: false }
  }

  // check if an action should be triggered
  function checkAction(
    action: ValidGamepadAction,
    pressed: boolean,
    controllerIndex: number
  ) {
    if (controllerIsDisabled) return

    if (!isFocused) {
      // ignore gamepad events if Heroic is not the focused app
      //
      // the browser still detects the gamepad interactions even
      // if the screen is not focused when playing a game
      return
    }

    // when the store webview is focused, its preload handles gamepad input
    // directly. Skip host-side handling to avoid double processing — but keep
    // `guide` working as a global escape hatch to toggle Console Mode.
    if (webviewHasFocus && action !== 'guide') {
      return
    }

    const data = actions[action]
    const triggeredAt = data.triggeredAt[controllerIndex]

    if (!pressed) {
      // set 0 if not pressed (means inactive button)
      data.triggeredAt[controllerIndex] = 0
      return
    }

    const now = new Date().getTime()

    // check if the action was already active or not
    const wasActive = triggeredAt !== 0

    let shouldRepeat = false
    if (wasActive) {
      // it it was active, check if the action should be repeated
      if (data.repeatDelay) {
        const lastTriggered = triggeredAt
        if (now - lastTriggered > data.repeatDelay) {
          shouldRepeat = true
        }
      }
    }

    if (!wasActive || shouldRepeat) {
      // console.log(`Action: ${action}`)

      // set last triggeredAt timestamp, used for repeater
      data.triggeredAt[controllerIndex] = now

      emitControllerEvent(controllerIndex)
      const el = currentElement()

      // Guide / PS button toggles Console Mode. Many OSes (Steam, Game Bar)
      // intercept it, so the sidebar entry is the reliable fallback.
      if (action === 'guide') {
        if (document.body.classList.contains('console-launching')) return
        const inConsole = window.location.hash.startsWith('#/console')
        window.location.hash = inConsole ? '#/' : '#/console'
        return
      }

      // `back` hits webContents.goBack() on the backend, which would pop
      // out of /console during a launch or while a console modal is open.
      if (
        action === 'back' &&
        (document.body.classList.contains('console-launching') ||
          document.body.classList.contains('console-modal-open'))
      ) {
        return
      }

      // check special cases for the different actions, more details on the wiki
      switch (action) {
        case 'mainAction':
          if (shouldSimulateClick()) {
            // some tags require a simulated click, some require a javascript click() call
            // if the current element requires a simulated click, change the action to `leftClick`
            action = 'leftClick'
          } else if (isGameCard()) {
            action = 'mainAction'
          } else if (VirtualKeyboardController.isButtonFocused()) {
            action = 'keyboardClick'
          } else if (isTextInput()) {
            // open virtual keyboard if focusing a text input
            VirtualKeyboardController.initOrFocus()
            return
          }
          break
        case 'back':
          if (VirtualKeyboardController.isActive()) {
            // closes the keyboard if present
            VirtualKeyboardController.destroy()
            return
          } else if (insideDialog()) {
            closeDialog()
            return
          } else if (insideDropdown()) {
            closeDropdown()
            return
          } else if (isSelect()) {
            // closes the select dropdown and re-focus element
            el?.blur()
            el?.focus()
            return
          } else if (isInMuiPopover()) {
            action = 'tab'
          } else if (isContextMenu()) {
            action = 'rightClick'
          }
          break
        case 'altAction':
          if (isGameCard()) {
            // launch game on pressing Y
            if (playable()) playGame()
            else installGame()
          } else if (VirtualKeyboardController.isActive()) {
            VirtualKeyboardController.space()
            return
          }
          break
        case 'rightClick':
          if (VirtualKeyboardController.isActive()) {
            VirtualKeyboardController.backspace()
            return
          }
          break
        case 'padLeft':
        case 'padRight':
        case 'padUp':
        case 'padDown':
        case 'leftStickDown':
        case 'leftStickLeft':
        case 'leftStickRight':
        case 'leftStickUp':
          if (!el) {
            // if we are not focusing anything, grab focus or we are stuck unable to move around
            document.querySelector('body')?.focus()
          } else {
            switch (action) {
              case 'padDown':
              case 'leftStickDown':
                // MUI Selects open on arrow down, which is usually not your intention
                // when navigating down with the stick, so we change the action to tab
                if (isMuiSelect()) {
                  action = 'tab'
                }
                if (isMuiDialogCloseButton()) {
                  action = 'tab'
                }
                break
              case 'padUp':
              case 'leftStickUp':
                // Same as above
                if (isMuiSelect()) {
                  action = 'shiftTab'
                }
                break
            }
          }
          break
      }

      if (action === 'mainAction') {
        currentElement()?.click()
      } else if (action === 'keyboardClick') {
        // we have to do this for the keyboard because:
        // simulated clicks break when zoomed in
        // normal `.click()` calls don't work because the buttons are divs
        const button = currentElement()
        const buttonCode = button?.dataset.skbtn
        if (buttonCode) VirtualKeyboardController.typeCharacter(buttonCode)
      } else {
        // we have to tell Electron to simulate key presses
        // so the spatial navigation works
        if (action !== 'leftClick' && action !== 'rightClick') {
          window.api.gamepadAction({ action })
        } else {
          const data = metadata()
          if (data) {
            window.api.gamepadAction({ action, metadata: data })
          } else {
            console.error(
              'Got controller action that requires metadata, but we have no metadata'
            )
          }
        }
      }
    }
  }

  const currentElement = () => {
    const el = document.querySelector<HTMLElement>(':focus')
    if (!el) return

    // we can't call `click` in svg elements, so we use its parent
    if (el.tagName === 'svg') return el.parentElement

    return el
  }

  const shouldSimulateClick = () => isSelect() || isMuiSelect()
  function isSelect() {
    const el = currentElement()
    if (!el) return false

    return el.tagName === 'SELECT'
  }

  function isTextInput() {
    const el = currentElement()
    if (!el) return false

    return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text'
  }

  function isGameCard() {
    const el = currentElement()
    if (!el) return false

    const parent = el.parentElement
    if (!parent) return false

    return parent.classList.contains('gameCard')
  }

  function isContextMenu() {
    const el = currentElement()
    if (!el) return false

    const parent = el.parentElement
    if (!parent) return false

    return parent.classList.contains('MuiMenu-list')
  }

  function isMuiSelect() {
    const el = currentElement()
    if (!el) return false

    return el.classList.contains('MuiSelect-select')
  }

  function isMuiDialogCloseButton() {
    const el = currentElement()
    if (!el) return false

    const isIconButton = el.classList.contains('MuiIconButton-root')
    if (!isIconButton) return false

    const parent = el.parentElement
    if (!parent) return false
    return parent.classList.contains('MuiDialog-paper')
  }

  function isInMuiPopover() {
    const el = currentElement()
    if (!el) return false

    return !!el.closest('.MuiPopover-root')
  }

  function playable() {
    const el = currentElement()
    if (!el) return false

    const parent = el.parentElement
    if (!parent) return false

    const classes = parent.classList
    const isGameCard =
      classes.contains('gameCard') || classes.contains('gameListItem')
    const isInstalled = classes.contains('installed')
    return isGameCard && isInstalled
  }

  function playGame() {
    const el = currentElement()
    if (!el) return false

    const parent = el.parentElement
    if (!parent) return false

    const playButton = parent.querySelector<HTMLButtonElement>('.playIcon')
    if (playButton) playButton.click()

    return true
  }

  function installGame() {
    const el = currentElement()
    if (!el) return false

    const parent = el.parentElement
    if (!parent) return false

    const installButton = parent.querySelector<HTMLButtonElement>('.downIcon')
    if (installButton) installButton.click()

    return true
  }

  function insideDialog() {
    const el = currentElement()
    if (!el) return false

    return !!el.closest('.MuiDialog-root')
  }

  function closeDialog() {
    const el = currentElement()
    if (!el) return false

    const dialog = el.closest('.MuiDialog-root')
    if (!dialog) return false

    const closeButton = dialog.querySelector<HTMLButtonElement>(
      '[aria-label="close"]'
    )
    if (!closeButton) return false

    closeButton.click()

    return true
  }

  function insideDropdown() {
    const el = currentElement()
    if (!el) return false

    return !!el.closest('.dropdown')
  }

  function closeDropdown() {
    const el = currentElement()
    if (!el) return false

    const dropdown = el.closest('.dropdownContainer')
    if (!dropdown) return false

    const closeButton =
      dropdown.querySelector<HTMLButtonElement>('.dropdownButton')
    if (!closeButton) return false

    // close selection, return focus to button
    closeButton.click()
    closeButton.focus()

    return true
  }

  function metadata() {
    const el = currentElement()
    if (el) {
      const rect = el.getBoundingClientRect()
      return {
        elementTag: el.tagName,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2)
      }
    } else {
      return undefined
    }
  }

  /**
   * Returns true, if the vendor ID is from valve, else false.
   *
   * @param gamepad
   */
  function isValveGamepad(gamepad: Gamepad | null) {
    return gamepad && gamepad.id.includes('Vendor: 28de')
  }

  /**
   * Returns gamepads that are from valve
   * - virtual gamepads through Steam Input
   * - real gamepads like Steam Deck or Steam Controller
   *
   * @param gamepads
   */
  function filterValveGamepads(gamepads: (Gamepad | null)[]) {
    return gamepads.filter(isValveGamepad)
  }

  /**
   * Returns true, if the gamepad is masked through Steam Input.
   * Checks if the timestamp of the gamepad is nearly identical of one of the valve gamepads.
   * There is a threshold of 10, because the timestamps differ from time to time.
   *
   * Attention: Without filtering masked gamepads, you have 2 button presses at the same time.
   *
   * @param valveGamepads
   * @param gamepad
   */
  function isMaskedGamepad(
    valveGamepads: (Gamepad | null)[],
    gamepad: Gamepad
  ) {
    return valveGamepads.find(
      (valveGamepad) =>
        valveGamepad &&
        Math.abs(valveGamepad.timestamp - gamepad.timestamp) <= 10
    )
  }

  function isValidGamepad(gamepads: (Gamepad | null)[], gamepad: Gamepad) {
    const valveGamepads = filterValveGamepads(gamepads)
    return isValveGamepad(gamepad) || !isMaskedGamepad(valveGamepads, gamepad)
  }

  // check all the buttons and axes every frame
  function updateStatus() {
    const gamepads = navigator.getGamepads()

    controllers.forEach((index) => {
      const controller = gamepads[index]
      if (!controller || !isValidGamepad(gamepads, controller)) return

      // logState(index)

      const buttons = controller.buttons
      const axes = controller.axes
      try {
        if (controller.id.match(/gamecube|0337/i)) {
          checkGameCube(buttons, axes, index, checkAction)
        } else if (controller.id.match(/2563.*0523/i)) {
          checkPS3Clone1(buttons, axes, index, checkAction)
        } else if (controller.id.match(/0079.*0006/i)) {
          checkN64Clone1(buttons, axes, index, checkAction)
        } else if (controller.id.match(/0583.*a009/i)) {
          checkGenius1(buttons, axes, index, checkAction)
        } else {
          // if not specific, fallback to the standard layout, seems
          // to be the most common for now and if not exact it seems
          // to cover at least the left stick and the main 2 buttons
          checkStandard(buttons, axes, index, checkAction)
        }
      } catch (error) {
        console.log('Gamepad error:', error)
      }
    })

    requestAnimationFrame(updateStatus)
  }

  // function logState(index: number) {
  //   const controller = navigator.getGamepads()[index]
  //   if (!controller) return

  //   const buttons = controller.buttons
  //   const axes = controller.axes

  //   for (const button in buttons) {
  //     if (buttons[button].pressed)
  //       console.log(`button ${button} pressed ${buttons[button].value}`)
  //   }
  //   for (const axis in axes) {
  //     if (axes[axis] < -0.2 && axes[axis] >= -1)
  //       console.log(`axis ${axis} activated negative`)
  //     if (axes[axis] > 0.2 && axes[axis] <= 1)
  //       console.log(`axis ${axis} activated positive`)
  //   }
  // }

  function connecthandler(e: GamepadEvent) {
    console.log('controller connected event')
    console.log(e)
    // Ignore Logitech's G29 Driving Force Racing Wheel
    if (e.gamepad.id.match(/046d.*c24f/i)) {
      return
    }
    addgamepad(e.gamepad)
  }

  function addgamepad(gamepad: Gamepad) {
    console.log(`Gamepad added: ${JSON.stringify(gamepad.id)}`)
    controllers.push(gamepad.index)
    requestAnimationFrame(updateStatus)
  }

  function disconnecthandler(e: GamepadEvent) {
    removegamepad(e.gamepad)
  }

  function removegamepad(gamepad: Gamepad) {
    const removedIndex = controllers.findIndex((idx) => idx === gamepad.index)

    // remove disconnected controller
    controllers = controllers.filter((idx) => idx !== gamepad.index)

    // if controller was the current controller, reset and emit
    if (removedIndex === currentController) {
      emitControllerEvent(-1)
    }
  }

  function dispatchControllerEvent(id: string) {
    const controllerEvent = new CustomEvent('controller-changed', {
      detail: {
        controllerId: id
      }
    })

    window.dispatchEvent(controllerEvent)
  }

  function emitControllerEvent(controllerIndex: number) {
    // don't emit a change if it didn't change
    if (currentController === controllerIndex) {
      return
    }

    // if disconnected event
    if (controllerIndex === -1) {
      currentController = controllerIndex
      dispatchControllerEvent('')
      return
    }

    // if not disconnected event, look for id
    const gamepads = navigator.getGamepads()
    const gamepad = gamepads[controllerIndex]
    if (!gamepad) {
      return
    }

    currentController = controllerIndex
    dispatchControllerEvent(gamepad.id)

    window.addEventListener(
      'mousemove',
      () => {
        currentController = -1
        dispatchControllerEvent('')
      },
      { once: true }
    )
  }

  window.addEventListener('gamepadconnected', connecthandler)
  window.addEventListener('gamepaddisconnected', disconnecthandler)
}

export const toggleControllerIsDisabled = (value: boolean | undefined) => {
  if (value !== undefined) {
    controllerIsDisabled = value
  } else {
    controllerIsDisabled = !controllerIsDisabled
  }
}
