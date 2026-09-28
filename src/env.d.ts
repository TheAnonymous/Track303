/// <reference types="vite/client" />

import type { Track303AudioTestApi } from "./sound/offline-test";

declare global {
  interface ImportMetaEnv {
    readonly VITE_APP_COMMIT?: string;
    readonly VITE_APP_BUILT_AT?: string;
  }

  interface Window {
    __track303AudioTest?: Track303AudioTestApi;
  }
}

export {};
