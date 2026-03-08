/** Minimum and default window dimensions. Prevents resize thrashing at tiny sizes. */
export const WINDOW_CONSTRAINTS = {
  width: 1400,
  height: 900,
  minWidth: 480,
  minHeight: 360,
} as const
