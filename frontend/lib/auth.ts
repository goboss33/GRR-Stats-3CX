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
                const groups = (profile as Record<string, unknown>)?.groups as string[] || [];
                const role = getRoleFromGroups(groups);
                
                if (!role) {
                    return "/login?error=AccessDenied";
                }
                
                const microsoftProfile = profile as {
                    givenName?: string;
                    surname?: string;
                    jobTitle?: string;
                    department?: string;
                    mobilePhone?: string;
                    officeLocation?: string;
                };
                
                const existingUser = await prismaAuth.user.findUnique({
                    where: { email: user.email! },
                });
                
                if (existingUser) {
                    await prismaAuth.user.update({
                        where: { email: user.email! },
                        data: {
                            role: role as "ADMIN" | "SUPERUSER" | "MODERATOR" | "USER",
                            authProvider: "MICROSOFT",
                            firstName: microsoftProfile.givenName || existingUser.firstName,
                            lastName: microsoftProfile.surname || existingUser.lastName,
                            jobTitle: microsoftProfile.jobTitle || null,
                            department: microsoftProfile.department || null,
                            mobilePhone: microsoftProfile.mobilePhone || null,
                            officeLocation: microsoftProfile.officeLocation || null,
                        },
                    });
                } else {
                    await prismaAuth.user.create({
                        data: {
                            email: user.email!,
                            firstName: microsoftProfile.givenName || null,
                            lastName: microsoftProfile.surname || null,
                            role: role as "ADMIN" | "SUPERUSER" | "MODERATOR" | "USER",
                            authProvider: "MICROSOFT",
                            password: "",
                            jobTitle: microsoftProfile.jobTitle || null,
                            department: microsoftProfile.department || null,
                            mobilePhone: microsoftProfile.mobilePhone || null,
                            officeLocation: microsoftProfile.officeLocation || null,
                        },
                    });
                }
            }
            return true;
        },
        async jwt({ token, user, account, profile }) {
            if (user) {
                token.id = user.id;
                token.role = user.role;
                token.firstName = user.firstName;
                token.lastName = user.lastName;
                token.authProvider = user.authProvider;
            }
            
            if (account?.provider === "microsoft-entra-id") {
                const groups = (profile as Record<string, unknown>)?.groups as string[] || [];
                const role = getRoleFromGroups(groups);
                if (role) {
                    token.role = role;
                }
                
                const dbUser = await prismaAuth.user.findUnique({
                    where: { email: token.email as string },
                });
                if (dbUser) {
                    token.id = dbUser.id;
                    token.firstName = dbUser.firstName;
                    token.lastName = dbUser.lastName;
                    token.authProvider = dbUser.authProvider;
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
