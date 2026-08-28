export const Logo = () => (
  <span
    className="font-mono font-semibold text-lg leading-none tracking-tight"
    style={{
      backgroundImage:
        'linear-gradient(90deg, #a882f0 0%, #6e96f5 20%, #5acde1 40%, #82d796 60%, #f0c86e 80%, #eb8282 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
    }}
  >
    arcade
  </span>
);

export const github = {
  branch: 'main',
  owner: 'vercel-labs',
  repo: 'arcade',
};

export const nav = [
  { label: 'AI Gateway', href: 'https://vercel.com/ai-gateway' },
];

export const title = 'Arcade';

export const translations = {
  en: { displayName: 'English' },
};

export const basePath: string | undefined = undefined;

export const siteId: string | undefined = 'arcade-site';
