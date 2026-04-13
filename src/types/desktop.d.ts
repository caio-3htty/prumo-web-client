export type DesktopQuickUnlockConfig = {
  enabled: boolean;
  hasPin: boolean;
};

export type DesktopBridge = {
  app: string;
  storage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
    clear: () => void;
  };
  quickUnlock?: {
    getConfig: () => Promise<DesktopQuickUnlockConfig>;
    setPin: (pin: string) => Promise<{ ok: boolean }>;
    verifyPin: (pin: string) => Promise<{ ok: boolean }>;
    disable: () => Promise<{ ok: boolean }>;
  };
};

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

