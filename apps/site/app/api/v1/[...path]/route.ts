function notFound(): Response {
  return Response.json({
    error: {
      code: 'API_ROUTE_NOT_FOUND',
      message: 'The requested Arcade API v1 route does not exist.',
      resolution: 'Read /openapi.json for supported operations or /llms.txt for agent resources.',
    },
  }, {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
