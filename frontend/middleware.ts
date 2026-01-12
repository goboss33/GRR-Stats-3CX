import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
    const { nextUrl } = req;
    const isLoggedIn = !!req.auth;

    // Protected routes
    const isProtectedRoute =
        nextUrl.pathname.startsWith("/dashboard") ||
        nextUrl.pathname.startsWith("/admin");

    // Auth routes (login page)
    const isAuthRoute = nextUrl.pathname.startsWith("/login");

    // Redirect to login if accessing protected route without auth
    if (isProtectedRoute && !isLoggedIn) {
        return NextResponse.redirect(new URL("/login", nextUrl));
    }

    // Redirect to dashboard if already logged in and trying to access login
    if (isAuthRoute && isLoggedIn) {
        return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }

    // Check admin routes - only ADMIN role can access
    if (nextUrl.pathname.startsWith("/admin") && isLoggedIn) {
        const userRole = req.auth?.user?.role;
        if (userRole !== "ADMIN") {
            return NextResponse.redirect(new URL("/dashboard", nextUrl));
        }
    }

    return NextResponse.next();
});

export const config = {
    matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
