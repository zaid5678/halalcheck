/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the HalalCheck API. Leave empty to use the same origin / dev proxy. */
  readonly VITE_HALALCHECK_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
