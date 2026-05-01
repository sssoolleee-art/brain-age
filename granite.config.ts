import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'brain-age',
  brand: {
    displayName: '두뇌나이',
    primaryColor: '#6C5CE7',
    icon: '',
  },
  web: {
    host: 'localhost',
    port: 5180,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  permissions: [],
});
