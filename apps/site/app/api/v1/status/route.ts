const RESPONSE_HEADERS = {
  'Cache-Control': 'public, max-age=300',
  'Content-Type': 'application/json; charset=utf-8',
};

export function GET(): Response {
  return Response.json({
    service: 'Arcade website',
    apiVersion: 'v1',
    status: 'ok',
    capabilities: {
      gameControl: false,
      modelExecution: false,
      installer: '/install',
      prismStream: '/api/v1/prism-stream',
      agentIndex: '/llms.txt',
      examples: '/examples.json',
    },
  }, { headers: RESPONSE_HEADERS });
}
