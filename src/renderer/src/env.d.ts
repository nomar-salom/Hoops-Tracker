/// <reference types="vite/client" />
import type { HoopsApi } from '@shared/ipc';

declare global {
  interface Window {
    /** Present inside Electron; undefined if the renderer is opened in a plain browser. */
    api?: HoopsApi;
  }
}
