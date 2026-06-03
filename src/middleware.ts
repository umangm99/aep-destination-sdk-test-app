import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateBasicAuth } from "@/lib/auth";

export function middleware(request: NextRequest) {
  // Validate Basic Auth for all incoming requests (UI and API)
  const auth = validateBasicAuth(request);

  if (!auth.valid) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="AEP Destination UI"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Apply authentication to all routes EXCEPT:
    // - _next/static (static files)
    // - _next/image (image optimization files)
    // - favicon.ico (favicon file)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
