import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'edu.bayoustate.game2d',
  appName: 'Bayou State 2D',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#1a2442',
    allowsLinkPreview: false,
    scrollEnabled: false,
  },
};

export default config;
