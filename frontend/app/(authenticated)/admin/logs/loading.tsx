import { Skeleton } from "@/components/ui/skeleton";

export default function LogsLoading() {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <div className="flex gap-2">
                    <Skeleton className="h-9 w-24" />
                    <Skeleton className="h-9 w-24" />
                    <Skeleton className="h-9 w-24" />
                    <Skeleton className="h-9 w-16" />
                </div>
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-96 rounded-lg" />
        </div>
    );
}
