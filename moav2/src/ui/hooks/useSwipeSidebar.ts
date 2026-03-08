import { useEffect } from 'react'

interface UseSwipeSidebarParams {
  isMobileLayout: boolean
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
}

export function useSwipeSidebar({
  isMobileLayout,
  mobileSidebarOpen,
  setMobileSidebarOpen,
}: UseSwipeSidebarParams) {
  useEffect(() => {
    if (!isMobileLayout) return

    const EDGE_ZONE_PX = 30
    const SWIPE_THRESHOLD_PX = 50
    const VELOCITY_THRESHOLD_PX_PER_SEC = 300
    const DIRECTION_LOCK_PX = 8

    let active = false
    let mode: 'open' | 'close' | null = null
    let pointerId: number | null = null
    let pointerTarget: Element | null = null
    let sidebarWidth = 260
    let startX = 0
    let startY = 0
    let startTime = 0
    let dx = 0
    let dy = 0
    let lockedDirection: 'horizontal' | 'vertical' | null = null

    const getSidebar = () => document.querySelector('.sidebar') as HTMLElement | null
    const getScrim = () => document.querySelector('.mobile-sidebar-scrim') as HTMLElement | null
    const getApp = () => document.querySelector('.app') as HTMLElement | null

    const clearInlineStyles = () => {
      const sidebar = getSidebar()
      if (sidebar) {
        sidebar.style.transition = ''
        sidebar.style.transform = ''
      }

      const scrim = getScrim()
      if (scrim) {
        scrim.style.transition = ''
        scrim.style.backgroundColor = ''
        scrim.style.opacity = ''
      }
    }

    const setScrimProgress = (progress: number) => {
      const scrim = getScrim()
      if (!scrim) return

      const clampedProgress = Math.max(0, Math.min(1, progress))
      const alpha = clampedProgress * 0.48
      scrim.style.opacity = '1'
      scrim.style.backgroundColor = `rgba(0, 0, 0, ${alpha})`
    }

    const setDragging = (dragging: boolean) => {
      const app = getApp()
      if (app) app.classList.toggle('sidebar-dragging', dragging)

      const sidebar = getSidebar()
      const scrim = getScrim()

      if (dragging) {
        if (sidebar) sidebar.style.transition = 'none'
        if (scrim) scrim.style.transition = 'none'
      } else {
        clearInlineStyles()
      }
    }

    const resetGesture = () => {
      active = false
      mode = null
      pointerId = null
      pointerTarget = null
      lockedDirection = null
      dx = 0
      dy = 0
      startTime = 0
    }

    const endGesture = (e: PointerEvent, cancelled: boolean) => {
      if (pointerId !== null && e.pointerId !== pointerId) return
      if (!active || !mode) return

      if (!cancelled && lockedDirection === 'horizontal') {
        const elapsedMs = Math.max(1, performance.now() - startTime)
        const velocity = (dx / elapsedMs) * 1000
        const horizontalEnough = Math.abs(dx) >= SWIPE_THRESHOLD_PX
        const velocityEnough = Math.abs(velocity) > VELOCITY_THRESHOLD_PX_PER_SEC

        if (horizontalEnough || velocityEnough) {
          if (mode === 'open' && dx > 0) setMobileSidebarOpen(true)
          if (mode === 'close' && dx < 0) setMobileSidebarOpen(false)
        }
      }

      if (pointerId !== null && pointerTarget) {
        pointerTarget.releasePointerCapture?.(pointerId)
      }

      resetGesture()
      setDragging(false)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return

      const target = e.target as Element | null
      const sidebar = getSidebar()
      if (!sidebar || !target) return

      const inEdge = !mobileSidebarOpen && e.clientX <= EDGE_ZONE_PX
      const inSidebar = mobileSidebarOpen && !!target.closest('.sidebar')
      const inScrim = mobileSidebarOpen && !!target.closest('.mobile-sidebar-scrim')

      if (!inEdge && !inSidebar && !inScrim) return

      active = true
      mode = inEdge ? 'open' : 'close'
      pointerId = e.pointerId
      pointerTarget = target
      sidebarWidth = Math.max(1, sidebar.getBoundingClientRect().width)
      startX = e.clientX
      startY = e.clientY
      startTime = performance.now()
      dx = 0
      dy = 0
      lockedDirection = null
      setDragging(true)
      target.setPointerCapture?.(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (pointerId !== null && e.pointerId !== pointerId) return
      if (!active || !mode) return

      const sidebar = getSidebar()
      if (!sidebar) return

      dx = e.clientX - startX
      dy = e.clientY - startY

      if (!lockedDirection) {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return
        lockedDirection = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical'
      }

      if (lockedDirection === 'vertical') {
        endGesture(e, true)
        return
      }

      e.preventDefault()

      if (mode === 'open') {
        const clampedDx = Math.max(0, Math.min(sidebarWidth, dx))
        const travel = -sidebarWidth + clampedDx
        const progress = clampedDx / sidebarWidth
        sidebar.style.transform = `translateX(${travel}px)`
        setScrimProgress(progress)
      } else {
        const clampedDx = Math.max(-sidebarWidth, Math.min(0, dx))
        const travel = clampedDx
        const progress = (sidebarWidth + clampedDx) / sidebarWidth
        sidebar.style.transform = `translateX(${travel}px)`
        setScrimProgress(progress)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      endGesture(e, false)
    }

    const onPointerCancel = (e: PointerEvent) => {
      endGesture(e, true)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      resetGesture()
      setDragging(false)
    }
  }, [isMobileLayout, mobileSidebarOpen, setMobileSidebarOpen])
}
