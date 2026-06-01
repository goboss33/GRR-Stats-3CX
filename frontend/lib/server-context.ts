import { cookies } from "next/headers";
import { ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";

export async function getSelectedServer(): Promise<ServerId> {
    const cookieStore = await cookies();
    const serverCookie = cookieStore.get("selectedServer");

    if (serverCookie?.value && isValidServer(serverCookie.value)) {
        return serverCookie.value;
    }

    return getDefaultServer();
}
