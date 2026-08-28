import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCUMENTS = {
  home: { filename: 'llms.txt', location: '/llms.txt' },
  docs: { filename: 'llms-full.txt', location: '/llms-full.txt' },
} as const;

const NOT_FOUND = `# Arcade resource not found

The requested path is not part of the public Arcade site.

- Read the agent index: /llms.txt
- Read the developer docs: /docs
- Inspect public pages: /sitemap.xml
- Inspect the HTTP surface: /openapi.json
`;

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  const { kind } = await context.params;
  if (kind === 'not-found') {
    return new Response(NOT_FOUND, {
      status: 404,
      headers: {
        'Content-Location': '/llms.txt',
        'Content-Type': 'text/markdown; charset=utf-8',
        Vary: 'Accept',
      },
    });
  }
  const document = DOCUMENTS[kind as keyof typeof DOCUMENTS];
  if (!document) {
    return Response.json({
      error: {
        code: 'AGENT_DOCUMENT_NOT_FOUND',
        message: 'The requested agent document does not exist.',
        resolution: 'Read /llms.txt for the Arcade agent index.',
      },
    }, { status: 404 });
  }

  const body = readFileSync(join(process.cwd(), 'public', document.filename), 'utf8');
  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Content-Location': document.location,
      'Content-Type': 'text/markdown; charset=utf-8',
      Vary: 'Accept',
    },
  });
}
