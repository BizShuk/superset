export type ProjectSubgroupType =
    | "aggregation"
    | "framework"
    | "tool"
    | "application"
    | "temporary";

export interface ProjectInfo {
    readonly name: string;
    readonly path: string;
    readonly subgroup: ProjectSubgroupType;
}

export interface SubgroupNode {
    readonly type: "subgroup";
    readonly id: ProjectSubgroupType;
    readonly label: string;
    readonly children: ProjectNode[];
}

export interface ProjectItemNode {
    readonly type: "project";
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly subgroup: ProjectSubgroupType;
}

export type ProjectNode = SubgroupNode | ProjectItemNode;

export type ProjectsListener = (projects: ProjectInfo[]) => void;
