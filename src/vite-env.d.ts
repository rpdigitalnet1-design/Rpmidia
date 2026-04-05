/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DRIVE_FOLDER_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
