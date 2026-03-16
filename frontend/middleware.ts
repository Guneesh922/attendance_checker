import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Pages that don't require authentication
const PUBLIC = ["/login", "/signup"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.includes(pathname)) return NextResponse.next();

  // Check for Firebase session cookie set by login page
  const session = request.cookies.get("session")?.value;
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next|favicon.ico|api).*)"] };
