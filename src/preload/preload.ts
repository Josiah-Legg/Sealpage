/**
 * Preload: the only bridge between the sandboxed renderer and the main
 * process. Exposes exactly the SealpageApi surface as `window.sealpage`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, IPC_PREFIX, type SealpageApi } from '../shared/ipc';

const api: Record<string, unknown> = {};

for (const name of INVOKE_CHANNELS) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(IPC_PREFIX + name, ...args);
}

for (const [method, channel] of Object.entries(EVENT_CHANNELS)) {
  api[method] = (callback: (...args: unknown[]) => void) => {
    const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => callback(...args);
    ipcRenderer.on(IPC_PREFIX + channel, listener);
    return () => {
      ipcRenderer.removeListener(IPC_PREFIX + channel, listener);
    };
  };
}

contextBridge.exposeInMainWorld('sealpage', api as unknown as SealpageApi);
