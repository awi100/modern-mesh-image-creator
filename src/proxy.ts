import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Temporarily simplified proxy - pass through all requests
export function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
