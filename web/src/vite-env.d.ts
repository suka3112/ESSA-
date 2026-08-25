/// <reference types="vite/client" />

/** Build-time settings the app reads from the environment. */
interface ImportMetaEnv {
  /**
   * Set to "off" to hide the demo persona switcher in the user menu.
   * Sign-in is Microsoft Entra ID in production, so a person is whoever their
   * corporate account says they are and switching has no meaning there.
   */
  readonly VITE_DEMO_PERSONAS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
