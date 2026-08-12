// Display a provider-qualified model slug without its provider prefix.
export function shortModel(slug: string): string {
  const slash = slug.indexOf('/');
  return slash >= 0 ? slug.slice(slash + 1) : slug;
}
