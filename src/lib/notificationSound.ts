/**
 * Web Audio and Browser Push Notification Utilities for Courier Alerts
 */

// Synthesize pleasant multi-tone alert chime using Web Audio API
export function playRouteAlertSound() {
  try {
    if (typeof window === 'undefined') return

    const AudioContextClass =
      window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext

    if (!AudioContextClass) return

    const ctx = new AudioContextClass()

    // Sound sequence: 3 pleasant harmonic tones (C5, E5, G5)
    const notes = [
      { freq: 523.25, time: 0, duration: 0.12 },
      { freq: 659.25, time: 0.14, duration: 0.14 },
      { freq: 783.99, time: 0.3, duration: 0.35 },
    ]

    notes.forEach((note) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.time)

      gain.gain.setValueAtTime(0.001, ctx.currentTime + note.time)
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + note.time + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.time + note.duration)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(ctx.currentTime + note.time)
      osc.stop(ctx.currentTime + note.time + note.duration + 0.05)
    })
  } catch (err) {
    console.warn('Audio playback error:', err)
  }
}

// Request and dispatch Native System Notification (when tab is in background or minimized)
export async function sendBrowserPushNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return

  try {
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
      })
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
        })
      }
    }
  } catch (err) {
    console.warn('Push notification error:', err)
  }
}

// Complete notification dispatcher: plays sound if active + browser push if in background/allowed
export function notifyCourierNewDelivery(title: string, message: string) {
  playRouteAlertSound()
  sendBrowserPushNotification(title, message)
}
