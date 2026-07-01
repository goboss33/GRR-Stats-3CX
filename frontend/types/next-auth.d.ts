import { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            role: string;
            firstName: string | null;
            lastName: string | null;
            authProvider: string;
            azureAdId?: string | null;
        } & DefaultSession["user"];
    }

    interface User {
        role: string;
        firstName: string | null;
        lastName: string | null;
        authProvider: string;
        azureAdId?: string | null;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        id: string;
        role: string;
        firstName: string | null;
        lastName: string | null;
        authProvider: string;
        azureAdId?: string | null;
    }
}
