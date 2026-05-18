// Preload script injected into store webviews (Epic, GOG, Amazon, Zoom).
// Runs in the guest WebContents. Uses ipcRenderer.sendToHost when available
// to talk back to the host, falling back silently if not.

let sendToHost = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require('electron')
  if (electron && electron.ipcRenderer) {
    sendToHost = (channel, payload) =>
      electron.ipcRenderer.sendToHost(channel, payload)
    electron.ipcRenderer.on('heroic-host', (_e, msg) => {
      if (msg && msg.type === 'set-disabled') disabled = !!msg.value
    })
  }
} catch (_) {
  // ipcRenderer not available — host-bound features (B blur, X URL bar,
  // guide) will be no-ops, but spatial navigation still works.
}

// --- Mouse back/forward buttons ---
// https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button
document.addEventListener('mouseup', (ev) => {
  switch (ev.button) {
    case 3:
      if (history.length > 1) {
        history.back()
        ev.preventDefault()
      }
      break
    case 4:
      history.forward()
      ev.preventDefault()
      break
  }
})

// --- Focus ring so the user can see what's selected ---
// Stores often hide :focus outlines; we force a visible one.
function injectFocusRing() {
  const style = document.createElement('style')
  style.setAttribute('data-heroic-focus', '')
  style.textContent =
    ':focus, :focus-visible { outline: 3px solid #ffae00 !important; outline-offset: 2px !important; }'
  document.documentElement.appendChild(style)
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFocusRing, { once: true })
} else {
  injectFocusRing()
}

// --- Gamepad navigation inside the webview ---

const KEY_REPEAT_DELAY = 500
const STICK_REPEAT_DELAY = 250
const SCROLL_REPEAT_DELAY = 50
const DEADZONE = 0.5

const actions = {
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
  mainAction: { triggeredAt: {}, repeatDelay: false },
  back: { triggeredAt: {}, repeatDelay: false },
  altAction: { triggeredAt: {}, repeatDelay: false },
  rightClick: { triggeredAt: {}, repeatDelay: false },
  prevPage: { triggeredAt: {}, repeatDelay: false },
  nextPage: { triggeredAt: {}, repeatDelay: false },
  guide: { triggeredAt: {}, repeatDelay: false }
}

// Valve gamepad filter — same logic as src/frontend/helpers/gamepad.ts
function isValveGamepad(gp) {
  return gp && gp.id.includes('Vendor: 28de')
}
function isMaskedGamepad(valveGamepads, gp) {
  return valveGamepads.find(
    (v) => v && Math.abs(v.timestamp - gp.timestamp) <= 10
  )
}
function isValidGamepad(gamepads, gp) {
  const valve = gamepads.filter(isValveGamepad)
  return isValveGamepad(gp) || !isMaskedGamepad(valve, gp)
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]),' +
  ' select:not([disabled]), textarea:not([disabled]),' +
  ' [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]'

function isVisible(el) {
  if (!el.offsetParent && el.tagName !== 'BODY') {
    const style = window.getComputedStyle(el)
    if (style.position !== 'fixed') return false
  }
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  // include elements just off-screen so navigation can pull them in
  const vh = window.innerHeight
  const vw = window.innerWidth
  return (
    r.bottom > -200 && r.top < vh + 200 && r.right > -200 && r.left < vw + 200
  )
}

function getFocusables() {
  return Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    isVisible
  )
}

function pickInitialFocus() {
  const list = getFocusables()
  if (!list.length) return null
  list.sort((a, b) => {
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    return ra.top - rb.top || ra.left - rb.left
  })
  return list[0]
}

function navigate(direction) {
  const current =
    document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : pickInitialFocus()
  if (!current) return false

  const curRect = current.getBoundingClientRect()
  const cx = curRect.left + curRect.width / 2
  const cy = curRect.top + curRect.height / 2

  let best = null
  let bestScore = Infinity

  for (const cand of getFocusables()) {
    if (cand === current) continue
    const r = cand.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy

    let inCone = false
    let perp = 0
    switch (direction) {
      case 'right':
        inCone = dx > 8 && Math.abs(dy) <= Math.abs(dx) * 1.5
        perp = Math.abs(dy)
        break
      case 'left':
        inCone = dx < -8 && Math.abs(dy) <= Math.abs(dx) * 1.5
        perp = Math.abs(dy)
        break
      case 'down':
        inCone = dy > 8 && Math.abs(dx) <= Math.abs(dy) * 1.5
        perp = Math.abs(dx)
        break
      case 'up':
        inCone = dy < -8 && Math.abs(dx) <= Math.abs(dy) * 1.5
        perp = Math.abs(dx)
        break
    }
    if (!inCone) continue

    const score = Math.hypot(dx, dy) + perp * 2
    if (score < bestScore) {
      bestScore = score
      best = cand
    }
  }

  if (best) {
    best.focus({ preventScroll: false })
    best.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth'
    })
    return true
  }

  // No candidate in the desired direction — fall back to scrolling.
  if (direction === 'down' || direction === 'up') {
    window.scrollBy({
      top: direction === 'down' ? 400 : -400,
      behavior: 'smooth'
    })
    return true
  }
  return false
}

function focusFirstSearchInput() {
  const candidates = document.querySelectorAll(
    'input[type="search"], input[type="text"], input[role="searchbox"], [role="search"] input'
  )
  for (const el of candidates) {
    if (isVisible(el)) {
      el.focus()
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      return true
    }
  }
  return false
}

function handleAction(action) {
  switch (action) {
    case 'mainAction': {
      const el = document.activeElement
      if (el && el !== document.body && typeof el.click === 'function')
        el.click()
      break
    }
    case 'back': {
      if (history.length > 1) {
        history.back()
      } else if (sendToHost) {
        // No history — let the host take over.
        sendToHost('heroic-webview', { type: 'blur-webview' })
      }
      break
    }
    case 'altAction': {
      // Y → focus first search/text input (opens host virtual keyboard via blur+focus).
      focusFirstSearchInput()
      break
    }
    case 'rightClick': {
      // X → focus the URL bar in the host's WebviewControls.
      if (sendToHost) sendToHost('heroic-webview', { type: 'focus-url-bar' })
      break
    }
    case 'prevPage':
      if (history.length > 1) history.back()
      break
    case 'nextPage':
      history.forward()
      break
    case 'guide':
      if (sendToHost) sendToHost('heroic-webview', { type: 'guide' })
      break
    case 'padUp':
    case 'leftStickUp':
      navigate('up')
      break
    case 'padDown':
    case 'leftStickDown':
      navigate('down')
      break
    case 'padLeft':
    case 'leftStickLeft':
      navigate('left')
      break
    case 'padRight':
    case 'leftStickRight':
      navigate('right')
      break
    case 'rightStickUp':
      window.scrollBy({ top: -60 })
      break
    case 'rightStickDown':
      window.scrollBy({ top: 60 })
      break
  }
}

function checkAction(action, pressed, controllerIndex) {
  const data = actions[action]
  if (!data) return
  const triggeredAt = data.triggeredAt[controllerIndex]

  if (!pressed) {
    data.triggeredAt[controllerIndex] = 0
    return
  }

  const now = Date.now()
  const wasActive = triggeredAt !== 0
  let shouldRepeat = false
  if (wasActive && data.repeatDelay) {
    if (now - triggeredAt > data.repeatDelay) shouldRepeat = true
  }

  if (!wasActive || shouldRepeat) {
    data.triggeredAt[controllerIndex] = now
    handleAction(action)
  }
}

// Standard layout — port of src/frontend/helpers/gamepad_layouts/standard.ts.
function checkStandard(buttons, axes, idx) {
  const A = buttons[0],
    B = buttons[1],
    X = buttons[2],
    Y = buttons[3],
    L1 = buttons[4],
    R1 = buttons[5],
    up = buttons[12],
    down = buttons[13],
    left = buttons[14],
    right = buttons[15],
    guide = buttons[16],
    lx = axes[0],
    ly = axes[1],
    ry = axes[3]

  checkAction('mainAction', !!A && A.pressed, idx)
  checkAction('back', !!B && B.pressed, idx)
  checkAction('rightClick', !!X && X.pressed, idx)
  checkAction('altAction', !!Y && Y.pressed, idx)
  checkAction('prevPage', !!L1 && L1.pressed, idx)
  checkAction('nextPage', !!R1 && R1.pressed, idx)
  checkAction('padUp', !!up && up.pressed, idx)
  checkAction('padDown', !!down && down.pressed, idx)
  checkAction('padLeft', !!left && left.pressed, idx)
  checkAction('padRight', !!right && right.pressed, idx)
  checkAction('leftStickLeft', lx < -DEADZONE, idx)
  checkAction('leftStickRight', lx > DEADZONE, idx)
  checkAction('leftStickUp', ly < -DEADZONE, idx)
  checkAction('leftStickDown', ly > DEADZONE, idx)
  checkAction('rightStickUp', ry < -DEADZONE, idx)
  checkAction('rightStickDown', ry > DEADZONE, idx)
  checkAction('guide', !!guide && guide.pressed, idx)
}

let controllers = []
let polling = false
let disabled = false

function updateStatus() {
  if (!controllers.length) {
    polling = false
    return
  }
  if (!disabled) {
    const gamepads = navigator.getGamepads()
    for (const idx of controllers) {
      const gp = gamepads[idx]
      if (!gp || !isValidGamepad(gamepads, gp)) continue
      try {
        checkStandard(gp.buttons, gp.axes, idx)
      } catch (e) {
        console.error('webview gamepad error', e)
      }
    }
  }
  requestAnimationFrame(updateStatus)
}

window.addEventListener('gamepadconnected', (e) => {
  if (e.gamepad.id.match(/046d.*c24f/i)) return // ignore G29 racing wheel
  if (!controllers.includes(e.gamepad.index)) controllers.push(e.gamepad.index)
  if (!polling) {
    polling = true
    requestAnimationFrame(updateStatus)
  }
})

window.addEventListener('gamepaddisconnected', (e) => {
  controllers = controllers.filter((i) => i !== e.gamepad.index)
})
