import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME =
    process.env.NODE_ENV === "production"
        ? "__Secure-authjs.session-token"
        : "authjs.session-token";

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
    const isLoggedIn = !!sessionCookie?.value;

    const isProtectedRoute =
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/admin") ||
        pathname.startsWith("/queues") ||
        pathname.startsWith("/statistics") ||
        pathname.startsWith("/documentation");

    const isAuthRoute = pathname.startsWith("/login");

    if (isProtectedRoute && !isLoggedIn) {
        return NextResponse.redirect(new URL("/login", request.nextUrl));
    }

    if (isAuthRoute && isLoggedIn) {
        return NextResponse.redirect(new URL("/dashboard", request.nextUrl));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
