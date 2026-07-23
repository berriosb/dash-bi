import { NextResponse } from 'next/server';

// Health check endpoint (no auth, used by Docker + load balancers)
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'dash-bi',
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}