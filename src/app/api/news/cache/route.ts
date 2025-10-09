import { NextRequest, NextResponse } from "next/server";

// Note: This API now uses in-memory caching instead of file-based caching
// for compatibility with serverless environments like Vercel

export async function DELETE(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message:
      "Cache is now in-memory per serverless instance. Use ?refresh=true on the /api/news endpoint to bypass cache.",
  });
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    cached: "unknown",
    message:
      "Cache is now in-memory per serverless instance. Each instance maintains its own cache during warm starts. Cache expires after 1 hour or on cold starts.",
    note: "Use ?refresh=true on the /api/news endpoint to bypass cache.",
  });
}
