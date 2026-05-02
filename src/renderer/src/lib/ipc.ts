import type { ElectronAPI } from '../../../preload'

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export const api = window.api
