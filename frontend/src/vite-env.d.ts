/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Satellite tile URL template. Defaults to Esri World Imagery. Imagery only; no street maps. */
  readonly VITE_BASEMAP_URL?: string;
  /** Attribution HTML required by the chosen imagery provider. */
  readonly VITE_BASEMAP_ATTRIBUTION?: string;
  /** Highest native zoom of the tile source (default 20). */
  readonly VITE_BASEMAP_MAX_NATIVE_ZOOM?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
