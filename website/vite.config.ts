import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SITE_URL = 'https://kidocoach.app';
const INDEXED_ROUTES = ['/', '/terms', '/privacy'];

function createSeoFilesPlugin() {
  return {
    name: 'create-seo-files',
    apply: 'build' as const,
    generateBundle() {
      const now = new Date().toISOString();
      const urls = INDEXED_ROUTES.map((route) => {
        const loc = route === '/' ? SITE_URL : `${SITE_URL}${route}`;
        return [
          '  <url>',
          `    <loc>${loc}</loc>`,
          `    <lastmod>${now}</lastmod>`,
          '    <changefreq>weekly</changefreq>',
          route === '/' ? '    <priority>1.0</priority>' : '    <priority>0.7</priority>',
          '  </url>',
        ].join('\n');
      }).join('\n');

      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        urls,
        '</urlset>',
      ].join('\n');

      const robots = [
        'User-agent: *',
        'Allow: /',
        '',
        `Sitemap: ${SITE_URL}/sitemap.xml`,
      ].join('\n');

      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: sitemap,
      });

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: robots,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), createSeoFilesPlugin()],
});
