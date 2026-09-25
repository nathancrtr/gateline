/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to '1' by `.env.static` under `vite build --mode static` (ADR-4). */
  readonly VITE_GATELINE_STATIC?: string
}
