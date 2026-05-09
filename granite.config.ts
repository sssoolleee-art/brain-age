import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'brainagetest',
  brand: {
    displayName: '두뇌나이',
    primaryColor: '#6C5CE7',
    icon: 'https://static.toss.im/appsintoss/27863/70405e17-bece-4765-9b4a-b3787e2c0e9b.png',
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
