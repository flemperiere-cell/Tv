import { registerSW } from 'virtual:pwa-register'

let updateAvailable = false
const listeners = new Set<() => void>()

function notifyUpdateAvailable() {
  updateAvailable = true
  listeners.forEach((listener) => listener())
}

export const updateSW = registerSW({
  onNeedRefresh: notifyUpdateAvailable,
})

export function subscribeToUpdate(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getUpdateSnapshot() {
  return updateAvailable
}
