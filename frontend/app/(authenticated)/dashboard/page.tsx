import { auth } from "@/lib/auth";
import { Phone, BarChart3, Users, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
    const session = await auth();
    const userRole = session?.user?.role || "USER";

    return (
        <div className="space-y-6">
            {/* Page Title */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
                <p className="text-slate-500">
                    Vue d&apos;ensemble des statistiques du centre d&apos;appels
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Appels totaux
                        </CardTitle>
                        <Phone className="h-5 w-5 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-900">--</div>
                        <p className="text-xs text-slate-500 mt-1">
                            Données disponibles après import
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Durée moyenne
                        </CardTitle>
                        <Clock className="h-5 w-5 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-900">--</div>
                        <p className="text-xs text-slate-500 mt-1">
                            Données disponibles après import
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Agents actifs
                        </CardTitle>
                        <Users className="h-5 w-5 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-900">--</div>
                        <p className="text-xs text-slate-500 mt-1">
                            Données disponibles après import
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Taux de réponse
                        </CardTitle>
                        <BarChart3 className="h-5 w-5 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-900">--</div>
                        <p className="text-xs text-slate-500 mt-1">
                            Données disponibles après import
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Placeholder Content */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Statistiques mensuelles
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64 flex items-center justify-center bg-slate-100 rounded-lg border-2 border-dashed border-slate-300">
                            <div className="text-center">
                                <BarChart3 className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-500 font-medium">
                                    Graphique des appels
                                </p>
                                <p className="text-sm text-slate-400">
                                    Disponible après import CSV
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Activité récente
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64 flex items-center justify-center bg-slate-100 rounded-lg border-2 border-dashed border-slate-300">
                            <div className="text-center">
                                <Clock className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-500 font-medium">
                                    Journal des activités
                                </p>
                                <p className="text-sm text-slate-400">
                                    Aucune activité récente
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Role-based message */}
            <Card className="border-blue-200 bg-blue-50">
                <CardContent className="p-4">
                    <p className="text-sm text-blue-800">
                        <span className="font-semibold">Votre rôle :</span>{" "}
                        {userRole === "ADMIN" && "Administrateur - Accès complet à toutes les fonctionnalités"}
                        {userRole === "SUPERUSER" && "Manager - Accès aux statistiques globales"}
                        {userRole === "USER" && "Utilisateur - Accès à votre tableau de bord personnel"}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
