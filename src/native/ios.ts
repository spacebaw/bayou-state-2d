import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
export const isTouchDevice =
  typeof window !== 'undefined' &&
  (isNativeIOS || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

/**
 * Configures native iOS full-screen status bar and viewport polish on launch.
 * Gracefully no-ops in standard desktop/mobile web browsers.
 */
export async function initNativeIOS(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.hide();
  } catch {
    // ignore if unavailable
  }
}

export function hapticTap(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export function hapticPlace(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

export function hapticHeavy(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
}

export function hapticSuccess(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export function hapticWarning(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
}

/**
 * Exports a captured Postcard PNG using native iOS Share Sheet ("Save Image") when supported,
 * falling back cleanly to a browser file download on desktop.
 */
export async function saveOrSharePostcard(dataUrl: string, filename: string): Promise<void> {
  try {
    if (isTouchDevice && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Bayou State 2D Postcard',
          files: [file],
        });
        hapticSuccess();
        return;
      }
    }
  } catch {
    // fall through to standard download if user cancelled or share unsupported
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
