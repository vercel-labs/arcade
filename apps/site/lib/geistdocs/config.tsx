import { defineConfig } from '@vercel/geistdocs/config';
import { basePath, github, siteId, title, translations } from '@/geistdocs';
import { isSiteUrlConfigured, siteUrl } from './site-url';

export const config = defineConfig({
  title,
  defaultLanguage: 'en',
  github,
  basePath,
  siteId,
  siteUrl: isSiteUrlConfigured ? siteUrl.toString() : undefined,
  translations,
});
