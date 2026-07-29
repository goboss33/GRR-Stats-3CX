import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prismaAuth } from "@/lib/prisma-auth";
import { logger } from "@/lib/logger";

function getRoleFromGroups(groups: string[]): string | null {
    const groupMappings = [
        { groupId: process.env.AZURE_GROUP_ADMIN_ID, role: "ADMIN" },
        { groupId: process.env.AZURE_GROUP_MODERATOR_ID, role: "MODERATOR" },
        // MANAGER/AGENT remplacent SUPERUSER/USER. Les anciennes variables restent
        // acceptées : un environnement non mis à jour (Portainer) continue de fonctionner.
        { groupId: process.env.AZURE_GROUP_MANAGER_ID ?? process.env.AZURE_GROUP_SUPERUSER_ID, role: "MANAGER" },
        { groupId: process.env.AZURE_GROUP_AGENT_ID ?? process.env.AZURE_GROUP_USER_ID, role: "AGENT" },
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
                    profilePicture: user.profilePicture,
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
                    const groups = (profile as Record<string, unknown>)?.groups as string[] || [];
                    const role = getRoleFromGroups(groups);
                    
                    if (!role) {
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
                    
                    // Use givenName/surname from Microsoft profile, fallback to user.name
                    const userNameParts = user.name?.split(" ") || [];
                    const firstName = microsoftProfile.givenName || 
                                      microsoftProfile.displayName?.split(" ")[0] || 
                                      userNameParts[0] || 
                                      "";
                    const lastName = microsoftProfile.surname || 
                                     microsoftProfile.displayName?.split(" ").slice(1).join(" ") || 
                                     userNameParts.slice(1).join(" ") || 
                                     "";
                    
                    // Fetch profile picture from Microsoft Graph API
                    let profilePicture: string | null = null;
                    if (account.access_token) {
                        try {
                            const photoResponse = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
                                headers: {
                                    Authorization: `Bearer ${account.access_token}`,
                                },
                            });
                            
                            if (photoResponse.ok) {
                                const photoBuffer = await photoResponse.arrayBuffer();
                                const base64Photo = Buffer.from(photoBuffer).toString("base64");
                                const contentType = photoResponse.headers.get("content-type") || "image/jpeg";
                                profilePicture = `data:${contentType};base64,${base64Photo}`;
                            }
                        } catch (error) {
                            logger.warn("[OAuth] Failed to fetch profile picture:", error);
                        }
                    }
                    
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
                        await prismaAuth.user.update({
                            where: { id: existingUser.id },
                            data: {
                                role: role as "ADMIN" | "MODERATOR" | "MANAGER" | "AGENT",
                                authProvider: "MICROSOFT",
                                azureAdId: user.id,
                                firstName: firstName || existingUser.firstName,
                                lastName: lastName || existingUser.lastName,
                                profilePicture: profilePicture || existingUser.profilePicture,
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
                                firstName: firstName,
                                lastName: lastName,
                                role: role as "ADMIN" | "MODERATOR" | "MANAGER" | "AGENT",
                                authProvider: "MICROSOFT",
                                azureAdId: user.id,
                                profilePicture: profilePicture,
                                password: "",
                                jobTitle: microsoftProfile.jobTitle || null,
                                department: microsoftProfile.department || null,
                                mobilePhone: microsoftProfile.mobilePhone || null,
                                officeLocation: microsoftProfile.officeLocation || null,
                            },
                        });
                    }
                    
                    // Clean up user object to avoid large JWT.
                    // Vue à propriétés optionnelles pour autoriser `delete` sans `any`.
                    const mutableUser = user as unknown as {
                        profilePicture?: unknown;
                        azureAdId?: unknown;
                        jobTitle?: unknown;
                        department?: unknown;
                        mobilePhone?: unknown;
                        officeLocation?: unknown;
                    };
                    delete mutableUser.profilePicture;
                    delete mutableUser.azureAdId;
                    delete mutableUser.jobTitle;
                    delete mutableUser.department;
                    delete mutableUser.mobilePhone;
                    delete mutableUser.officeLocation;
                } catch (error) {
                    logger.error("[OAuth] Sign in error:", error);
                    return "/login?error=OAuthSignInFailed";
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
                token.authProvider = user.authProvider || "CREDENTIALS";
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
            
            // Nettoyer les champs inutiles pour réduire la taille du token
            delete token.picture;  // On récupère la photo depuis la DB
            delete token.name;     // On a déjà firstName/lastName
            delete token.sub;      // On a déjà id
            
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
