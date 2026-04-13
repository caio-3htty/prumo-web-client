import type { DesktopQuickUnlockConfig } from "@/types/desktop";

const defaultQuickUnlockConfig: DesktopQuickUnlockConfig = {
  enabled: false,
  hasPin: false,
};

export const hasDesktopBridge = () =>
  typeof window !== "undefined" && typeof window.desktop !== "undefined";

export const hasDesktopStorageBridge = () =>
  hasDesktopBridge() &&
  typeof window.desktop?.storage?.getItem === "function" &&
  typeof window.desktop?.storage?.setItem === "function";

export const hasDesktopQuickUnlockBridge = () =>
  hasDesktopBridge() &&
  typeof window.desktop?.quickUnlock?.getConfig === "function";

export const getDesktopStorage = () => {
  if (hasDesktopStorageBridge()) {
    return window.desktop!.storage!;
  }
  return typeof window !== "undefined" ? window.localStorage : undefined;
};

export const getQuickUnlockConfig = async (): Promise<DesktopQuickUnlockConfig> => {
  if (!hasDesktopQuickUnlockBridge()) {
    return defaultQuickUnlockConfig;
  }
  try {
    return (await window.desktop!.quickUnlock!.getConfig()) ?? defaultQuickUnlockConfig;
  } catch {
    return defaultQuickUnlockConfig;
  }
};

export const setQuickUnlockPin = async (pin: string): Promise<boolean> => {
  if (!hasDesktopQuickUnlockBridge()) return false;
  try {
    const result = await window.desktop!.quickUnlock!.setPin(pin);
    return !!result?.ok;
  } catch {
    return false;
  }
};

export const verifyQuickUnlockPin = async (pin: string): Promise<boolean> => {
  if (!hasDesktopQuickUnlockBridge()) return false;
  try {
    const result = await window.desktop!.quickUnlock!.verifyPin(pin);
    return !!result?.ok;
  } catch {
    return false;
  }
};

export const disableQuickUnlock = async (): Promise<boolean> => {
  if (!hasDesktopQuickUnlockBridge()) return false;
  try {
    const result = await window.desktop!.quickUnlock!.disable();
    return !!result?.ok;
  } catch {
    return false;
  }
};

