import { Skeleton } from "@/components/ui/skeleton";

export default function DocumentationLoading() {
    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-64" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Skeleton className="h-96 rounded-lg" />
                <div className="lg:col-span-2 space-y-4">
                    <Skeleton className="h-12 rounded-lg" />
                    <Skeleton className="h-64 rounded-lg" />
                </div>
            </div>
        </div>
    );
}
