"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Error boundary du groupe authentifié : capte les erreurs de rendu des pages
// tout en conservant la coquille (sidebar + header) fournie par le layout.
export default function AuthenticatedError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Diagnostic côté client ; aucun détail sensible n'est montré à l'utilisateur.
        console.error(error);
    }, [error]);

    return (
        <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                    <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <h1 className="mt-4 text-xl font-semibold text-slate-900">Une erreur est survenue</h1>
                <p className="mt-2 text-sm text-slate-500">
                    Impossible d&apos;afficher cette page pour le moment. Réessayez ou revenez plus tard.
                </p>
                <Button onClick={reset} className="mt-6">
                    Réessayer
                </Button>
            </div>
        </div>
    );
}
