import { NextRequest, NextResponse } from 'next/server';

// Note: Middleware runs in Edge Runtime and cannot use Node.js APIs
// Auto-sync functionality has been moved to the frontend
export async function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/api/data/:path*']
};
