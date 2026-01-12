import { Upload, FileText, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function UploadPage() {
    return (
        <div className="space-y-6">
            {/* Page Title */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Upload CSV</h1>
                <p className="text-slate-500">
                    Importez les exports mensuels du système 3CX
                </p>
            </div>

            {/* Upload Area */}
            <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-semibold text-slate-900">
                        Importer un fichier
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors cursor-pointer">
                        <Upload className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-slate-900 mb-2">
                            Glissez-déposez votre fichier CSV ici
                        </h3>
                        <p className="text-sm text-slate-500 mb-4">
                            ou cliquez pour sélectionner un fichier
                        </p>
                        <Button variant="outline" disabled>
                            <FileText className="h-4 w-4 mr-2" />
                            Sélectionner un fichier
                        </Button>
                    </div>

                    <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium text-amber-800">
                                Fonctionnalité à venir
                            </h4>
                            <p className="text-sm text-amber-700 mt-1">
                                L&apos;import de fichiers CSV sera disponible dans la Phase 2 du
                                projet. Cette page sera utilisée pour importer les exports
                                mensuels du système téléphonique 3CX.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Instructions */}
            <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-semibold text-slate-900">
                        Instructions
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            1
                        </div>
                        <div>
                            <h4 className="font-medium text-slate-900">
                                Exportez les données depuis 3CX
                            </h4>
                            <p className="text-sm text-slate-500">
                                Accédez à votre console 3CX et exportez les statistiques
                                d&apos;appels au format CSV.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            2
                        </div>
                        <div>
                            <h4 className="font-medium text-slate-900">
                                Importez le fichier CSV
                            </h4>
                            <p className="text-sm text-slate-500">
                                Utilisez la zone de dépôt ci-dessus pour importer votre fichier.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            3
                        </div>
                        <div>
                            <h4 className="font-medium text-slate-900">
                                Visualisez les statistiques
                            </h4>
                            <p className="text-sm text-slate-500">
                                Les données seront automatiquement traitées et affichées dans le
                                tableau de bord.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
