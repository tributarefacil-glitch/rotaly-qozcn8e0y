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

// Dedicated alert sound for route deviation (>300m) or unexpected stop (urgent two-tone siren chime)
export function playOffRouteWarningSound() {
  try {
    if (typeof window === 'undefined') return

    const AudioContextClass =
      window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext

    if (!AudioContextClass) return

    const ctx = new AudioContextClass()

    // Sharp warning buzzer tones (A5 -> D6 -> A5)
    const tones = [
      { freq: 880.0, time: 0, duration: 0.15 },
      { freq: 1174.66, time: 0.18, duration: 0.18 },
      { freq: 880.0, time: 0.38, duration: 0.25 },
    ]

    tones.forEach((note) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.time)

      gain.gain.setValueAtTime(0.001, ctx.currentTime + note.time)
      gain.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + note.time + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.time + note.duration)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(ctx.currentTime + note.time)
      osc.stop(ctx.currentTime + note.time + note.duration + 0.05)
    })
  } catch (err) {
    console.warn('Off-route audio warning error:', err)
  }
}

/**
 * Alarme contínuo de ~30 segundos para Alertas de Presença Forçada (Bloco 1).
 * Toca padrão de sirene repetida durante até 30s ou até o usuário parar explicitamente.
 * Retorna função stop() para cancelamento imediato ao usuário tocar em "Entendi".
 */
let activeLongAlarmController: { stop: () => void } | null = null

export function playLongPresenceAlarm(durationSeconds = 30): { stop: () => void } {
  try {
    if (activeLongAlarmController) {
      activeLongAlarmController.stop()
      activeLongAlarmController = null
    }

    if (typeof window === 'undefined') {
      return { stop: () => {} }
    }

    const AudioContextClass =
      window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext

    if (!AudioContextClass) {
      return { stop: () => {} }
    }

    const ctx = new AudioContextClass()
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }

    let isStopped = false
    const scheduledNodes: { osc: OscillatorNode; gain: GainNode }[] = []

    const cycleLength = 0.8 // ciclo de 800ms (dois bips agudos de sirene)
    const cyclesCount = Math.ceil(durationSeconds / cycleLength)

    const now = ctx.currentTime

    for (let c = 0; c < cyclesCount; c++) {
      const cycleStart = now + c * cycleLength
      if (cycleStart > now + durationSeconds) break

      // Tom 1: 900Hz
      const osc1 = ctx.createOscillator()
      const gain1 = ctx.createGain()
      osc1.type = 'sawtooth'
      osc1.frequency.setValueAtTime(920, cycleStart)
      gain1.gain.setValueAtTime(0.001, cycleStart)
      gain1.gain.exponentialRampToValueAtTime(0.8, cycleStart + 0.03)
      gain1.gain.exponentialRampToValueAtTime(0.001, cycleStart + 0.32)
      osc1.connect(gain1)
      gain1.connect(ctx.destination)
      osc1.start(cycleStart)
      osc1.stop(cycleStart + 0.35)
      scheduledNodes.push({ osc: osc1, gain: gain1 })

      // Tom 2: 1250Hz
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.type = 'square'
      osc2.frequency.setValueAtTime(1250, cycleStart + 0.38)
      gain2.gain.setValueAtTime(0.001, cycleStart + 0.38)
      gain2.gain.exponentialRampToValueAtTime(0.7, cycleStart + 0.41)
      gain2.gain.exponentialRampToValueAtTime(0.001, cycleStart + 0.72)
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.start(cycleStart + 0.38)
      osc2.stop(cycleStart + 0.75)
      scheduledNodes.push({ osc: osc2, gain: gain2 })
    }

    const autoStopTimer = setTimeout(() => {
      stop()
    }, durationSeconds * 1000)

    const stop = () => {
      if (isStopped) return
      isStopped = true
      clearTimeout(autoStopTimer)
      scheduledNodes.forEach(({ osc, gain }) => {
        try {
          gain.gain.setValueAtTime(0.001, ctx.currentTime)
          osc.stop(ctx.currentTime + 0.05)
        } catch {
          /* ignore */
        }
      })
      setTimeout(() => {
        try {
          ctx.close().catch(() => {})
        } catch {
          /* ignore */
        }
      }, 100)
      if (activeLongAlarmController?.stop === stop) {
        activeLongAlarmController = null
      }
    }

    const controller = { stop }
    activeLongAlarmController = controller
    return controller
  } catch (err) {
    console.warn('Long presence alarm error:', err)
    return { stop: () => {} }
  }
}

export function stopLongPresenceAlarm() {
  if (activeLongAlarmController) {
    activeLongAlarmController.stop()
    activeLongAlarmController = null
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
