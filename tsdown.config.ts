import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: ['src/index.ts'],
  tsconfig: './tsconfig.json',
  clean: true,
  dts: { sourcemap: true },
  platform: 'neutral',
  format: 'esm',
});

export default config;
