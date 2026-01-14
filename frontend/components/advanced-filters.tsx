"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Search, Phone, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import type { CallDirection, CallStatus, EntityType, LogsFilters } from "@/types/logs.types";

interface AdvancedFiltersProps {
    filters: LogsFilters;
    onChange: (filters: LogsFilters) => void;
}

const directionOptions: { value: CallDirection; label: string }[] = [
    { value: "inbound", label: "Entrant" },
    { value: "outbound", label: "Sortant" },
    { value: "internal", label: "Interne" },
];

const statusOptions: { value: CallStatus; label: string }[] = [
    { value: "answered", label: "Répondu" },
    { value: "missed", label: "Manqué" },
    { value: "abandoned", label: "Abandonné" },
];

const entityOptions: { value: EntityType; label: string }[] = [
    { value: "extension", label: "Extensions" },
    { value: "external", label: "Externes" },
    { value: "queue", label: "Files d'attente" },
    { value: "ivr", label: "IVR/Scripts" },
];

const durationPresets = [
    { label: "< 30s", min: 0, max: 30 },
    { label: "30s - 2min", min: 30, max: 120 },
    { label: "2 - 5min", min: 120, max: 300 },
    { label: "> 5min", min: 300, max: undefined },
];

export function AdvancedFilters({ filters, onChange }: AdvancedFiltersProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const handleDirectionChange = (dir: CallDirection, checked: boolean) => {
        const newDirs = checked
            ? [...filters.directions, dir]
            : filters.directions.filter((d) => d !== dir);
        onChange({ ...filters, directions: newDirs });
    };

    const handleStatusChange = (status: CallStatus, checked: boolean) => {
        const newStatuses = checked
            ? [...filters.statuses, status]
            : filters.statuses.filter((s) => s !== status);
        onChange({ ...filters, statuses: newStatuses });
    };

    const handleEntityChange = (entity: EntityType, checked: boolean) => {
        const newEntities = checked
            ? [...filters.entityTypes, entity]
            : filters.entityTypes.filter((e) => e !== entity);
        onChange({ ...filters, entityTypes: newEntities });
    };

    const handleDurationPreset = (min: number, max: number | undefined) => {
        onChange({ ...filters, durationMin: min, durationMax: max });
    };

    const clearDuration = () => {
        onChange({ ...filters, durationMin: undefined, durationMax: undefined });
    };

    const activeFilterCount =
        (filters.statuses.length > 0 ? 1 : 0) +
        (filters.entityTypes.length > 0 ? 1 : 0) +
        (filters.durationMin !== undefined || filters.durationMax !== undefined ? 1 : 0) +
        (filters.extensionExact ? 1 : 0) +
        (filters.externalNumber ? 1 : 0);

    return (
        <div className="space-y-4">
            {/* Main row: directions + search */}
            <div className="flex flex-wrap items-end gap-4">
                {/* Direction checkboxes */}
                <div>
                    <Label className="text-sm text-slate-600 mb-2 block">Direction</Label>
                    <div className="flex items-center gap-4">
                        {directionOptions.map((opt) => (
                            <div key={opt.value} className="flex items-center gap-2">
                                <Checkbox
                                    id={`dir-${opt.value}`}
                                    checked={filters.directions.includes(opt.value)}
                                    onCheckedChange={(checked) =>
                                        handleDirectionChange(opt.value, checked as boolean)
                                    }
                                />
                                <Label htmlFor={`dir-${opt.value}`} className="text-sm cursor-pointer">
                                    {opt.label}
                                </Label>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Extension exact search */}
                <div className="flex-1 min-w-[160px] max-w-[200px]">
                    <Label className="text-sm text-slate-600 mb-1.5 block">Extension (exact)</Label>
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="101"
                            value={filters.extensionExact || ""}
                            onChange={(e) => onChange({ ...filters, extensionExact: e.target.value })}
                            className="pl-9"
                        />
                    </div>
                </div>

                {/* External number search */}
                <div className="flex-1 min-w-[180px] max-w-[250px]">
                    <Label className="text-sm text-slate-600 mb-1.5 block">Numéro externe</Label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="+4179..."
                            value={filters.externalNumber || ""}
                            onChange={(e) => onChange({ ...filters, externalNumber: e.target.value })}
                            className="pl-9"
                        />
                    </div>
                </div>

                {/* Advanced toggle */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="gap-2"
                >
                    Filtres avancés
                    {activeFilterCount > 0 && (
                        <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-xs">
                            {activeFilterCount}
                        </Badge>
                    )}
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
            </div>

            {/* Advanced filters panel */}
            {isExpanded && (
                <Card className="border-dashed">
                    <CardContent className="pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Status */}
                            <div>
                                <Label className="text-sm font-medium mb-2 block">Statut</Label>
                                <div className="space-y-2">
                                    {statusOptions.map((opt) => (
                                        <div key={opt.value} className="flex items-center gap-2">
                                            <Checkbox
                                                id={`status-${opt.value}`}
                                                checked={filters.statuses.includes(opt.value)}
                                                onCheckedChange={(checked) =>
                                                    handleStatusChange(opt.value, checked as boolean)
                                                }
                                            />
                                            <Label htmlFor={`status-${opt.value}`} className="text-sm cursor-pointer">
                                                {opt.label}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Entity type */}
                            <div>
                                <Label className="text-sm font-medium mb-2 block">Type d&apos;entité</Label>
                                <div className="space-y-2">
                                    {entityOptions.map((opt) => (
                                        <div key={opt.value} className="flex items-center gap-2">
                                            <Checkbox
                                                id={`entity-${opt.value}`}
                                                checked={filters.entityTypes.includes(opt.value)}
                                                onCheckedChange={(checked) =>
                                                    handleEntityChange(opt.value, checked as boolean)
                                                }
                                            />
                                            <Label htmlFor={`entity-${opt.value}`} className="text-sm cursor-pointer">
                                                {opt.label}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Duration */}
                            <div>
                                <Label className="text-sm font-medium mb-2 block">Durée</Label>
                                <div className="flex flex-wrap gap-2">
                                    {durationPresets.map((preset) => {
                                        const isActive =
                                            filters.durationMin === preset.min && filters.durationMax === preset.max;
                                        return (
                                            <Button
                                                key={preset.label}
                                                variant={isActive ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => handleDurationPreset(preset.min, preset.max)}
                                            >
                                                {preset.label}
                                            </Button>
                                        );
                                    })}
                                    {(filters.durationMin !== undefined || filters.durationMax !== undefined) && (
                                        <Button variant="ghost" size="sm" onClick={clearDuration}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
