import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react'

import { detectControllerLayout, type ControllerLayout } from './controller'

function isPressed(btn: GamepadButton | undefined) {
  return !!btn && (btn.pressed || btn.value > 0.5)
}

export function useGamepadButtonPress(
  buttonIndex: number,
  onPress: () => void,
  enabled = true
) {
  const handlerRef = useRef(onPress)
  handlerRef.current = onPress

  useEffect(() => {
    if (!enabled) return
    const prev = new Map<number, boolean>()
    let raf = 0
    const tick = () => {
      for (const gp of navigator.getGamepads()) {
        if (!gp) continue
        const pressed = isPressed(gp.buttons[buttonIndex])
        if (pressed && !prev.get(gp.index)) handlerRef.current()
        prev.set(gp.index, pressed)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [buttonIndex, enabled])
}

export function useGamepadButtonHold(
  buttonIndex: number,
  onChange: (held: boolean) => void,
  enabled = true
) {
  const handlerRef = useRef(onChange)
  handlerRef.current = onChange

  useEffect(() => {
    if (!enabled) return
    let held = false
    let raf = 0
    const tick = () => {
      let anyHeld = false
      for (const gp of navigator.getGamepads()) {
        if (gp && isPressed(gp.buttons[buttonIndex])) {
          anyHeld = true
          break
        }
      }
      if (anyHeld !== held) {
        held = anyHeld
        handlerRef.current(anyHeld)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [buttonIndex, enabled])
}

export function useGamepadInfo() {
  const [connected, setConnected] = useState(false)
  const [layout, setLayout] = useState<ControllerLayout>('xbox')

  useEffect(() => {
    const refresh = () => {
      const first = Array.from(navigator.getGamepads()).find(
        (gp): gp is Gamepad => !!gp
      )
      setConnected(!!first)
      if (first) setLayout(detectControllerLayout(first.id))
    }
    refresh()
    window.addEventListener('gamepadconnected', refresh)
    window.addEventListener('gamepaddisconnected', refresh)
    return () => {
      window.removeEventListener('gamepadconnected', refresh)
      window.removeEventListener('gamepaddisconnected', refresh)
    }
  }, [])

  return { connected, layout }
}

export function useColumnCount(
  cardRefs: RefObject<Array<HTMLElement | null>>,
  cardsLength: number
) {
  const [columns, setColumns] = useState(1)

  useLayoutEffect(() => {
    const compute = () => {
      const cards = (cardRefs.current ?? []).filter(
        (el): el is HTMLElement => !!el
      )

      if (cards.length < 2) {
        setColumns(1)
        return
      }
      const firstTop = cards[0].offsetTop

      let count = 1
      for (let i = 1; i < cards.length; i++) {
        if (cards[i].offsetTop !== firstTop) break
        count++
      }
      setColumns(Math.max(1, count))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [cardRefs, cardsLength])

  return columns
}

export function useCancelOnHold({
  active,
  holdMs,
  onCancel
}: {
  active: boolean
  holdMs: number
  onCancel: () => void
}) {
  const [holdStart, setHoldStart] = useState<number | null>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  const startHold = useCallback(() => {
    setHoldStart((v) => v ?? Date.now())
  }, [])
  const stopHold = useCallback(() => setHoldStart(null), [])

  useEffect(() => {
    if (!active) setHoldStart(null)
  }, [active])

  useEffect(() => {
    if (holdStart == null || !active) return
    const t = window.setTimeout(() => {
      onCancelRef.current()
      setHoldStart(null)
    }, holdMs)
    return () => window.clearTimeout(t)
  }, [holdStart, active, holdMs])

  return { holdStart, startHold, stopHold }
}
