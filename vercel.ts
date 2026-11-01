import { deploymentEnv, routes, type VercelConfig } from '@vercel/config/v1';

const backend = deploymentEnv('BACKEND_ORIGIN').replace(/\/$/, '');

export const config: VercelConfig = {
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    routes.rewrite('/api/:path*', `${backend}/api/:path*`),
    routes.rewrite('/auth/:path*', `${backend}/auth/:path*`),
    routes.rewrite('/game/:channel', '/index.html'),
    routes.rewrite('/overlay/:channel', '/index.html'),
    routes.rewrite('/play', '/index.html'),
    routes.rewrite('/play/:code', '/index.html'),
  ],
};
