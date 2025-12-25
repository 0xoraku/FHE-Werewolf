/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEREWOLF_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
