import { Settings, Phone, Users, Bell, Database, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
    return (
        <div className="space-y-6">
            {/* Page Title */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
                <p className="text-slate-500">
                    Configuration du système et gestion des extensions
                </p>
            </div>

            {/* Coming Soon Notice */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                    <h4 className="font-medium text-amber-800">Phase 1 - Squelette</h4>
                    <p className="text-sm text-amber-700 mt-1">
                        Les fonctionnalités de paramétrage seront implémentées dans les
                        phases suivantes. Cette page montre la structure prévue.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Extensions Management */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center gap-3">
                        <Phone className="h-5 w-5 text-blue-500" />
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Gestion des Extensions
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="extension" className="text-slate-700">
                                Numéro d&apos;extension
                            </Label>
                            <Input
                                id="extension"
                                placeholder="Ex: 100"
                                disabled
                                className="bg-slate-100"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="agent-name" className="text-slate-700">
                                Nom de l&apos;agent
                            </Label>
                            <Input
                                id="agent-name"
                                placeholder="Ex: Jean Dupont"
                                disabled
                                className="bg-slate-100"
                            />
                        </div>
                        <Button disabled className="w-full">
                            <Phone className="h-4 w-4 mr-2" />
                            Ajouter une extension
                        </Button>
                    </CardContent>
                </Card>

                {/* User Management */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center gap-3">
                        <Users className="h-5 w-5 text-green-500" />
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Gestion des Utilisateurs
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="user-email" className="text-slate-700">
                                Email
                            </Label>
                            <Input
                                id="user-email"
                                type="email"
                                placeholder="nouveau@exemple.com"
                                disabled
                                className="bg-slate-100"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="user-role" className="text-slate-700">
                                Rôle
                            </Label>
                            <Input
                                id="user-role"
                                placeholder="Sélectionner un rôle"
                                disabled
                                className="bg-slate-100"
                            />
                        </div>
                        <Button disabled className="w-full">
                            <Users className="h-4 w-4 mr-2" />
                            Ajouter un utilisateur
                        </Button>
                    </CardContent>
                </Card>

                {/* Notifications */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center gap-3">
                        <Bell className="h-5 w-5 text-amber-500" />
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Notifications
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-slate-100 rounded-lg">
                                <span className="text-sm text-slate-600">
                                    Alertes par email
                                </span>
                                <div className="w-10 h-5 bg-slate-300 rounded-full opacity-50"></div>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-slate-100 rounded-lg">
                                <span className="text-sm text-slate-600">
                                    Rapports hebdomadaires
                                </span>
                                <div className="w-10 h-5 bg-slate-300 rounded-full opacity-50"></div>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-slate-100 rounded-lg">
                                <span className="text-sm text-slate-600">
                                    Alertes de performance
                                </span>
                                <div className="w-10 h-5 bg-slate-300 rounded-full opacity-50"></div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Database */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center gap-3">
                        <Database className="h-5 w-5 text-purple-500" />
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Base de données
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="p-3 bg-slate-100 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-600">
                                        Espace utilisé
                                    </span>
                                    <span className="text-sm text-slate-500">-- / -- MB</span>
                                </div>
                                <div className="w-full h-2 bg-slate-200 rounded-full">
                                    <div className="w-0 h-2 bg-purple-500 rounded-full"></div>
                                </div>
                            </div>
                            <Button variant="outline" disabled className="w-full">
                                <Database className="h-4 w-4 mr-2" />
                                Exporter les données
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
