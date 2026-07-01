import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prismaAuth } from "@/lib/prisma-auth";

function getRoleFromGroups(groups: string[]): string | null {
    const groupMappings = [
        { groupId: process.env.AZURE_GROUP_ADMIN_ID, role: "ADMIN" },
        { groupId: process.env.AZURE_GROUP_SUPERUSER_ID, role: "SUPERUSER" },
        { groupId: process.env.AZURE_GROUP_MODERATOR_ID, role: "MODERATOR" },
        { groupId: process.env.AZURE_GROUP_USER_ID, role: "USER" },
    ];

    for (const mapping of groupMappings) {
        if (mapping.groupId && groups.includes(mapping.groupId)) {
            return mapping.role;
        }
    }

    return null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                const user = await prismaAuth.user.findUnique({
                    where: { email: credentials.email as string },
                });

                if (!user) {
                    return null;
                }

                const passwordMatch = await bcrypt.compare(
                    credentials.password as string,
                    user.password
                );

                if (!passwordMatch) {
                    return null;
                }

                return {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    authProvider: user.authProvider,
                };
            },
        }),
        MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
            issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
            authorization: {
                url: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/oauth2/v2.0/authorize`,
                params: {
                    scope: "openid profile email User.Read",
                    prompt: "login",
                },
            },
            token: {
                url: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/oauth2/v2.0/token`,
            },
            userinfo: {
                url: "https://graph.microsoft.com/oidc/userinfo",
            },
        }),
    ],
    callbacks: {
        async signIn({ user, account, profile }) {
            if (account?.provider === "microsoft-entra-id") {
                try {
                    console.log("[OAuth] === Sign In Callback ===");
                    console.log("[OAuth] User email:", user.email);
                    console.log("[OAuth] User name:", user.name);
                    console.log("[OAuth] Azure AD Object ID:", user.id);
                    
                    const groups = (profile as Record<string, unknown>)?.groups as string[] || [];
                    console.log("[OAuth] Groups from token:", groups.length, "groups");
                    
                    const role = getRoleFromGroups(groups);
                    console.log("[OAuth] Mapped role:", role);
                    
                    if (!role) {
                        console.warn("[OAuth] No matching group found, access denied");
                        return "/login?error=AccessDenied";
                    }
                    
                    const microsoftProfile = profile as {
                        givenName?: string;
                        surname?: string;
                        displayName?: string;
                        jobTitle?: string;
                        department?: string;
                        mobilePhone?: string;
                        officeLocation?: string;
                    };
                    
                    console.log("[OAuth] Microsoft profile:", {
                        givenName: microsoftProfile.givenName,
                        surname: microsoftProfile.surname,
                        displayName: microsoftProfile.displayName,
                        jobTitle: microsoftProfile.jobTitle,
                        department: microsoftProfile.department,
                    });
                    
                    // Fallback logic for incomplete profiles
                    const firstName = microsoftProfile.givenName || 
                                      microsoftProfile.displayName?.split(" ")[0] || 
                                      user.email!.split("@")[0];
                    const lastName = microsoftProfile.surname || 
                                     microsoftProfile.displayName?.split(" ").slice(1).join(" ") || 
                                     "";
                    
                    console.log("[OAuth] Resolved name:", { firstName, lastName });
                    
                    // Try to find user by Azure AD ID first, then by email
                    let existingUser = await prismaAuth.user.findUnique({
                        where: { azureAdId: user.id },
                    });
                    
                    if (!existingUser && user.email) {
                        existingUser = await prismaAuth.user.findUnique({
                            where: { email: user.email },
                        });
                    }
                    
                    if (existingUser) {
                        console.log("[OAuth] Updating existing user:", existingUser.id);
                        await prismaAuth.user.update({
                            where: { id: existingUser.id },
                            data: {
                                role: role as "ADMIN" | "SUPERUSER" | "MODERATOR" | "USER",
                                authProvider: "MICROSOFT",
                                azureAdId: user.id,
                                firstName: firstName || existingUser.firstName,
                                lastName: lastName || existingUser.lastName,
                                jobTitle: microsoftProfile.jobTitle || null,
                                department: microsoftProfile.department || null,
                                mobilePhone: microsoftProfile.mobilePhone || null,
                                officeLocation: microsoftProfile.officeLocation || null,
                            },
                        });
                    } else {
                        console.log("[OAuth] Creating new user");
                        await prismaAuth.user.create({
                            data: {
                                email: user.email!,
                                firstName: firstName,
                                lastName: lastName,
                                role: role as "ADMIN" | "SUPERUSER" | "MODERATOR" | "USER",
                                authProvider: "MICROSOFT",
                                azureAdId: user.id,
                                password: "",
                                jobTitle: microsoftProfile.jobTitle || null,
                                department: microsoftProfile.department || null,
                                mobilePhone: microsoftProfile.mobilePhone || null,
                                officeLocation: microsoftProfile.officeLocation || null,
                            },
                        });
                    }
                    
                    console.log("[OAuth] Sign in successful");
                } catch (error) {
                    console.error("[OAuth] Sign in error:", error);
                    return "/login?error=OAuthSignInFailed";
                }
            }
            return true;
        },
        async jwt({ token, user, account, profile }) {
            if (user) {
                console.log("[OAuth JWT] Setting token from user:", { id: user.id, email: token.email });
                token.id = user.id;
                token.role = user.role;
                token.firstName = user.firstName;
                token.lastName = user.lastName;
                token.authProvider = user.authProvider || "CREDENTIALS";
            }
            
            if (account?.provider === "microsoft-entra-id") {
                console.log("[OAuth JWT] Microsoft provider detected, fetching user from DB");
                
                // Clean up large fields from token to avoid cookie size issues
                delete (token as any).groups;
                delete (token as any).picture;
                delete (token as any).accessToken;
                delete (token as any).refreshToken;
                
                const groups = (profile as Record<string, unknown>)?.groups as string[] || [];
                const role = getRoleFromGroups(groups);
                if (role) {
                    token.role = role;
                }
                
                const dbUser = await prismaAuth.user.findUnique({
                    where: { email: token.email as string },
                });
                if (dbUser) {
                    console.log("[OAuth JWT] User found in DB:", { id: dbUser.id, role: dbUser.role });
                    token.id = dbUser.id;
                    token.firstName = dbUser.firstName;
                    token.lastName = dbUser.lastName;
                    token.authProvider = dbUser.authProvider;
                } else {
                    console.warn("[OAuth JWT] User not found in DB for email:", token.email);
                }
            }
            
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id as string;
                session.user.role = token.role as string;
                session.user.firstName = token.firstName as string | null;
                session.user.lastName = token.lastName as string | null;
                session.user.authProvider = token.authProvider as string;
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
    session: {
        strategy: "jwt",
    },
});
