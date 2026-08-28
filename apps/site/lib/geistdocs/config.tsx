import { defineConfig } from '@vercel/geistdocs/config';
import { basePath, github, Logo, nav, siteId, title, translations } from '@/geistdocs';
import { isSiteUrlConfigured, siteUrl } from './site-url';

export const config = defineConfig({
  title,
  defaultLanguage: 'en',
  logo: <Logo />,
  navbarVariant: 'oss',
  github,
  nav,
  basePath,
  siteId,
  siteUrl: isSiteUrlConfigured ? siteUrl.toString() : undefined,
  translations,
});
