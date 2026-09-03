import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1) ?? 'andvg93-stack.github.io';
const basePath = repository.endsWith('.github.io') ? '' : `/${repository}`;
const vinextCli = resolve('node_modules/vinext/dist/cli.js');

const result = spawnSync(process.execPath, [vinextCli, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GITHUB_PAGES: 'true',
    GITHUB_PAGES_BASE_PATH: basePath,
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
});

if (result.error) throw result.error;

const outputIndex = resolve('dist/client/index.html');
if (result.status !== 0 && (process.platform !== 'win32' || !existsSync(outputIndex))) {
  process.exit(result.status ?? 1);
}
if (!existsSync(outputIndex)) throw new Error('La exportación estática no generó dist/client/index.html.');

writeFileSync(resolve('dist/client/.nojekyll'), '');
