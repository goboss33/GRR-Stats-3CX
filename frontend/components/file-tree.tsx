"use client";

import React, { useState } from "react";
import {
    Folder,
    FolderOpen,
    FileCode,
    FileJson,
    FileType,
    File,
    ChevronRight,
    ChevronDown,
} from "lucide-react";

export interface FileNode {
    name: string;
    type: "file" | "folder";
    shortDesc?: string;
    details?: {
        role: string;
        dependencies?: string[];
        example?: string;
        pitfalls?: string;
    };
    children?: FileNode[];
}

function getFileIcon(name: string, isOpen: boolean) {
    if (name.endsWith(".tsx") || name.endsWith(".ts")) return <FileCode className="h-4 w-4 text-blue-500" />;
    if (name.endsWith(".json")) return <FileJson className="h-4 w-4 text-yellow-500" />;
    if (name.endsWith(".css") || name.endsWith(".scss")) return <FileType className="h-4 w-4 text-sky-400" />;
    if (name.endsWith(".prisma") || name.endsWith(".sql")) return <FileType className="h-4 w-4 text-emerald-500" />;
    if (name.endsWith(".yml") || name.endsWith(".yaml")) return <FileType className="h-4 w-4 text-pink-500" />;
    if (name.endsWith(".md")) return <FileType className="h-4 w-4 text-slate-500" />;
    return <File className="h-4 w-4 text-slate-400" />;
}

function TreeNode({
    node,
    depth = 0,
    selectedPath,
    onSelect,
    currentPath,
}: {
    node: FileNode;
    depth?: number;
    selectedPath: string;
    onSelect: (path: string, node: FileNode) => void;
    currentPath: string;
}) {
    const [isOpen, setIsOpen] = useState(true);
    const isFolder = node.type === "folder";
    const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
    const isSelected = selectedPath === fullPath;

    return (
        <div>
            <button
                onClick={() => {
                    if (isFolder) setIsOpen(!isOpen);
                    onSelect(fullPath, node);
                }}
                className={`flex items-center gap-2 py-1 px-2 rounded-md transition-colors w-full text-left ${
                    isSelected ? "bg-blue-50 text-blue-700" : "hover:bg-slate-100"
                }`}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
                {isFolder ? (
                    isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    )
                ) : (
                    <span className="w-3.5" />
                )}
                {isFolder ? (
                    isOpen ? (
                        <FolderOpen className="h-4 w-4 text-amber-500" />
                    ) : (
                        <Folder className="h-4 w-4 text-amber-500" />
                    )
                ) : (
                    getFileIcon(node.name, isOpen)
                )}
                <span
                    className={`text-sm ${
                        isFolder ? "font-semibold" : ""
                    }`}
                >
                    {node.name}
                </span>
            </button>

            {isFolder && isOpen && node.children && (
                <div className="mt-0.5">
                    {node.children.map((child, idx) => (
                        <TreeNode
                            key={idx}
                            node={child}
                            depth={depth + 1}
                            selectedPath={selectedPath}
                            onSelect={onSelect}
                            currentPath={fullPath}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function FileTreeExplorer({ data }: { data: FileNode[] }) {
    const [selectedPath, setSelectedPath] = useState<string>("");
    const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);

    const handleSelect = (path: string, node: FileNode) => {
        setSelectedPath(path);
        setSelectedNode(node);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden" style={{ minHeight: "600px" }}>
            {/* Left: Tree */}
            <div className="lg:col-span-2 border-r border-slate-200 p-4 overflow-y-auto bg-slate-50/50">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">
                    Explorateur
                </p>
                <div className="space-y-0.5">
                    {data.map((node, idx) => (
                        <TreeNode
                            key={idx}
                            node={node}
                            selectedPath={selectedPath}
                            onSelect={handleSelect}
                            currentPath=""
                        />
                    ))}
                </div>
            </div>

            {/* Right: Details */}
            <div className="lg:col-span-3 p-6 overflow-y-auto bg-white">
                {selectedNode?.details ? (
                    <div className="space-y-5">
                        <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                                {selectedNode.type === "folder" ? "Dossier" : "Fichier"}
                            </p>
                            <h3 className="text-lg font-bold text-slate-900">{selectedNode.name}</h3>
                            {selectedNode.shortDesc && (
                                <p className="text-sm text-slate-500 mt-1">{selectedNode.shortDesc}</p>
                            )}
                        </div>

                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                            <h4 className="text-sm font-semibold text-slate-800 mb-2">Rôle dans l'application</h4>
                            <p className="text-sm text-slate-600 leading-relaxed">{selectedNode.details.role}</p>
                        </div>

                        {selectedNode.details.dependencies && selectedNode.details.dependencies.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold text-slate-800 mb-2">Dépendances et liens</h4>
                                <ul className="space-y-1.5">
                                    {selectedNode.details.dependencies.map((dep, i) => (
                                        <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                                            <span className="text-blue-500 mt-1">&#8226;</span>
                                            {dep}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {selectedNode.details.example && (
                            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                                <h4 className="text-sm font-semibold text-blue-900 mb-2">Exemple concret</h4>
                                <p className="text-sm text-blue-800 leading-relaxed">{selectedNode.details.example}</p>
                            </div>
                        )}

                        {selectedNode.details.pitfalls && (
                            <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                                <h4 className="text-sm font-semibold text-amber-900 mb-2">Points d'attention</h4>
                                <p className="text-sm text-amber-800 leading-relaxed">{selectedNode.details.pitfalls}</p>
                            </div>
                        )}
                    </div>
                ) : selectedNode ? (
                    <div className="text-center text-slate-400 mt-20">
                        <p className="text-sm">Aucune documentation détaillée disponible pour cet élément.</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <FolderOpen className="h-12 w-12 mb-3 text-slate-300" />
                        <p className="text-sm font-medium">Sélectionnez un dossier ou un fichier</p>
                        <p className="text-xs mt-1">pour afficher sa documentation détaillée</p>
                    </div>
                )}
            </div>
        </div>
    );
}
