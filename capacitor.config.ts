import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.schooleventapp.app',
  appName: 'School Event App',
  webDir: 'www',
  plugins: {
    Keyboard: {
      resize: 'none'
    }
  }
};

export default config;
