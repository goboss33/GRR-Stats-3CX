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
            tenantId: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID!,
            authorization: {
                params: {
                    scope: "openid profile email User.Read",
                },
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
                
                const existingUser = await prismaAuth.user.findUnique({
                    where: { email: user.email! },
                });
                
                if (existingUser) {
                    await prismaAuth.user.update({
                        where: { email: user.email! },
                        data: { role: role as "ADMIN" | "SUPERUSER" | "MODERATOR" | "USER" },
                    });
                } else {
                    const nameParts = (profile?.name || "").split(" ");
                    await prismaAuth.user.create({
                        data: {
                            email: user.email!,
                            firstName: nameParts[0] || null,
                            lastName: nameParts.slice(1).join(" ") || null,
                            role: role as "ADMIN" | "SUPERUSER" | "MODERATOR" | "USER",
                            password: "",
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
