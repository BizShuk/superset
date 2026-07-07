import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ProjectInfo, ProjectNode, ProjectSubgroupType, ProjectsListener } from "./types";

const FRAMEWORK_PROJECTS = new Set([
    "gosdk",
    "pm2",
    "inf",
    "routine_agent",
    "cc-plugin",
    "env_setup",
    "m-agent",
    "yfinance-go",
    "superset"
]);

const TOOL_PROJECTS = new Set([
    "macnotesapp",
    "macemailapp",
    "port_listenor"
]);

const AGGREGATION_PROJECTS = new Set([
    "product"
]);

export class ProjectStore {
    private projects: ProjectInfo[] = [];
    private listeners = new Set<ProjectsListener>();

    start(): void {
        // Eager scan on start
        this.scan().catch(() => {});
    }

    stop(): void {
        this.projects = [];
        this.listeners.clear();
    }

    reset(): void {
        this.projects = [];
        this.scan().catch(() => {});
    }

    getProjects(): ProjectInfo[] {
        return this.projects;
    }

    getRoots(): ProjectNode[] {
        const subgroupMap: Record<ProjectSubgroupType, { label: string; children: ProjectNode[] }> = {
            aggregation: { label: "匯集層 (Aggregation)", children: [] },
            application: { label: "應用層 (Application)", children: [] },
            framework: { label: "框架層 (Framework)", children: [] },
            tool: { label: "工具層 (Tool)", children: [] },
            temporary: { label: "暫存區 (Temporary)", children: [] }
        };

        for (const p of this.projects) {
            subgroupMap[p.subgroup].children.push({
                type: "project",
                id: p.path,
                name: p.name,
                path: p.path,
                subgroup: p.subgroup
            });
        }

        // Sort children alphabetically in each subgroup
        for (const key of Object.keys(subgroupMap) as ProjectSubgroupType[]) {
            subgroupMap[key].children.sort((a, b) => {
                if (a.type === "project" && b.type === "project") {
                    return a.name.localeCompare(b.name);
                }
                return 0;
            });
        }

        // Return the roots in a predefined order
        return (["aggregation", "application", "framework", "tool", "temporary"] as ProjectSubgroupType[]).map(key => ({
            type: "subgroup",
            id: key,
            label: subgroupMap[key].label,
            children: subgroupMap[key].children
        }));
    }

    async scan(): Promise<void> {
        const homeProjectsDir = path.join(os.homedir(), "projects");
        const tmpProjectsDir = path.join(homeProjectsDir, "tmp");

        const mainDirs = await this.scanDirectory(homeProjectsDir);
        const tmpDirs = await this.scanDirectory(tmpProjectsDir);

        const nextProjects: ProjectInfo[] = [];

        for (const dirName of mainDirs) {
            if (dirName === "tmp") {
                continue;
            }

            let subgroup: ProjectSubgroupType = "application";
            if (AGGREGATION_PROJECTS.has(dirName)) {
                subgroup = "aggregation";
            } else if (FRAMEWORK_PROJECTS.has(dirName)) {
                subgroup = "framework";
            } else if (TOOL_PROJECTS.has(dirName)) {
                subgroup = "tool";
            }

            nextProjects.push({
                name: dirName,
                path: path.join(homeProjectsDir, dirName),
                subgroup
            });
        }

        for (const dirName of tmpDirs) {
            nextProjects.push({
                name: dirName,
                path: path.join(tmpProjectsDir, dirName),
                subgroup: "temporary"
            });
        }

        this.projects = nextProjects;
        this.emit();
    }

    private async scanDirectory(dirPath: string): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory() && !e.name.startsWith("."))
                .map(e => e.name);
        } catch (e) {
            return [];
        }
    }

    onDidChange(listener: ProjectsListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        for (const l of this.listeners) {
            l(this.projects);
        }
    }
}
