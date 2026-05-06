export default function Loading() {
    return (
        <div className="flex items-center justify-center h-screen text-slate-500">
            <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                <p>Chargement des statistiques...</p>
            </div>
        </div>
    );
}
