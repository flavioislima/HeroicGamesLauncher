export type ControllerLayout =
  | 'ps4'
  | 'ps5'
  | 'xbox'
  | 'nintendo'
  | 'steam-deck'

// Standard gamepad button indices (Chromium "standard" mapping).
export const BTN_BACK = 1
export const BTN_L1 = 4
export const BTN_R1 = 5
export const BTN_R2 = 7

export function detectControllerLayout(id: string): ControllerLayout {
  if (/054c|PS3|054c.*09cc|0268|'2563.*0523/i.test(id)) return 'ps4'
  if (/054c.*0ce6/i.test(id)) return 'ps5'
  if (/28de.*11ff/.test(id)) return 'steam-deck'
  if (/microsoft|xbox/i.test(id)) return 'xbox'
  if (/nintendo|057e|switch|joy.?con|pro.?controller/i.test(id))
    return 'nintendo'
  return 'xbox'
}

export const getBackButtonLabel = (layout: ControllerLayout) =>
  layout.startsWith('ps') ? '◯' : 'B'
