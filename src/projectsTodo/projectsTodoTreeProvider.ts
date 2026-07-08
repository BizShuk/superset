import * as vscode from "vscode";
import * as path from "path";
import type { ProjectTodoItem } from "./types";
import type { ProjectsTodoStore } from "./projectsTodoStore";
import { isArchivedSubsection, cleanTags, isArchivedTask } from "../todo/parser";
import {
    filterCompleted,
    applyPriorityFilter,
    extractLink,
    cleanLabelText
} from "../todo/todoTreeProvider";

/**
 * vscode-bound TreeDataProvider for the Projects TODO list.
 * Reads from a ProjectsTodoStore (which reads from multiple README.todo files).
 */
export class ProjectsTodoTreeProvider
    implements vscode.TreeDataProvider<ProjectTodoItem>
{
    private readonly emitter = new vscode.EventEmitter<
        ProjectTodoItem | ProjectTodoItem[] | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeStore?: () => void;
    private showCompleted = false;
    private enabledPriorities = new Set<"P0" | "P1" | "P2">();

    constructor(
        private readonly store: ProjectsTodoStore,
        private readonly extensionUri?: vscode.Uri
    ) {}

    start(): void {
        if (this.unsubscribeStore) return;
        this.unsubscribeStore = this.store.onDidChange(() => {
            this.refresh();
        });
    }

    stop(): void {
        this.unsubscribeStore?.();
        this.unsubscribeStore = undefined;
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    toggleShowCompleted(): boolean {
        this.showCompleted = !this.showCompleted;
        this.refresh();
        return this.showCompleted;
    }

    isShowingCompleted(): boolean {
        return this.showCompleted;
    }

    togglePriorityFilter(p: "P0" | "P1" | "P2"): boolean {
        if (this.enabledPriorities.has(p)) {
            this.enabledPriorities.delete(p);
        } else {
            this.enabledPriorities.add(p);
        }
        this.refresh();
        return this.enabledPriorities.has(p);
    }

    isPriorityEnabled(p: "P0" | "P1" | "P2"): boolean {
        return this.enabledPriorities.has(p);
    }

    getTreeItem(element: ProjectTodoItem): vscode.TreeItem {
        // 1. If it's a project section node
        const isProjectNode = element.line === -1 && element.projectPath && element.text === path.basename(element.projectPath);
        if (isProjectNode) {
            const item = new vscode.TreeItem(element.text);
            item.iconPath = new vscode.ThemeIcon("folder");
            // Show pending (unchecked) task count as description.
            // Children are already filtered by showCompleted / priority,
            // so the count naturally excludes archived items when the
            // hide-completed filter is active.
            const pending = countPending(element.children);
            item.description = `${pending} pending`;
            item.tooltip = element.projectPath;
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            item.contextValue = "projectsTodoProject";
            // No item.command — clicking the row text folds/unfolds the section.
            // Opening the project is an inline button (see package.json menus).
            return item;
        }

        // 2. If it's a normal section inside a project
        if (element.kind === "section") {
            const item = new vscode.TreeItem(element.text);
            item.iconPath = new vscode.ThemeIcon("tag");
            if (element.text === "README.todo") {
                item.iconPath = new vscode.ThemeIcon("file-text");
            } else if (element.text.includes(".")) {
                item.iconPath = new vscode.ThemeIcon("file");
            }
            // Compute contextValue once and reuse for the badge decision
            // below and the final contextValue assignment.
            const sectionContext = this.computeSectionContextValue(element);
            // Append a half-circle badge showing the count of pending
            // (unchecked) checkboxes. Children were already filtered by
            // showCompleted / priority in getChildren, so the count
            // respects the active filter. Archive sub-sections are
            // skipped — by definition they hold finished work, so a
            // "0 ◐" badge is noise rather than signal.
            if (sectionContext !== "projectsTodoSectionArchived") {
                const pending = countPending(element.children);
                item.description = `${pending} ◐`;
            }
            item.tooltip = element.text;
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            item.contextValue = sectionContext;
            return item;
        }

        // 3. List or Checkbox items
        let labelText = element.text;
        labelText = cleanTags(labelText);

        const priorityMatch = labelText.match(/^(\[|\()?(P[0-2])(\]|\))?[\s-:]*/i);
        let labelTextCleaned = priorityMatch
            ? labelText.substring(priorityMatch[0].length).trim()
            : labelText;

        const hasLink = extractLink(labelTextCleaned) !== null;
        if (hasLink) {
            labelTextCleaned = cleanLabelText(labelTextCleaned);
        }

        const item = new vscode.TreeItem(labelTextCleaned);

        if (element.kind === "list") {
            if (priorityMatch && this.extensionUri) {
                const p = priorityMatch[2]!.toUpperCase();
                item.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", `${p.toLowerCase()}.svg`);
            } else {
                item.iconPath = new vscode.ThemeIcon(
                    "dash",
                    new vscode.ThemeColor("descriptionForeground")
                );
            }
            item.tooltip = cleanTags(element.text);
            item.collapsibleState =
                element.children && element.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None;

            const isArchived = isArchivedTask(element.text) || element.parentSection?.toLowerCase() === "archive";
            if (isArchived) {
                item.contextValue = hasLink ? "projectsTodoListWithLinkArchived" : "projectsTodoListArchived";
            } else {
                item.contextValue = hasLink ? "projectsTodoListWithLink" : "projectsTodoList";
            }
            return item;
        }

        // Else: checkbox
        if (priorityMatch && !element.checked && this.extensionUri) {
            const p = priorityMatch[2]!.toUpperCase();
            item.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", `${p.toLowerCase()}.svg`);
        } else {
            item.iconPath = new vscode.ThemeIcon(
                element.checked ? "pass" : "circle-large-outline",
                element.checked
                    ? new vscode.ThemeColor("charts.green")
                    : new vscode.ThemeColor("charts.yellow")
            );
        }

        item.description = element.checked ? "✓" : undefined;
        item.tooltip = element.checked
            ? `${cleanTags(element.text)} (completed)`
            : `${cleanTags(element.text)} (pending)`;
        item.collapsibleState =
            element.children && element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;
        
        item.checkboxState = element.checked
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;

        const isArchived = isArchivedTask(element.text) || element.parentSection?.toLowerCase() === "archive";
        if (isArchived) {
            item.contextValue = hasLink ? "projectsTodoCheckboxWithLinkArchived" : "projectsTodoCheckboxArchived";
        } else {
            item.contextValue = hasLink ? "projectsTodoCheckboxWithLink" : "projectsTodoCheckbox";
        }
        return item;
    }

    private computeSectionContextValue(element: ProjectTodoItem): string {
        if (element.level === undefined) return "projectsTodoSection";
        if (element.level === 2 && element.text.toLowerCase() === "archive") return "projectsTodoSection";
        
        const subStore = this.store.getStore(element.projectPath);
        if (subStore && isArchivedSubsection(subStore.getItems(), element)) {
            return "projectsTodoSectionArchived";
        }
        return "projectsTodoSectionArchivable";
    }

    getChildren(element?: ProjectTodoItem): vscode.ProviderResult<ProjectTodoItem[]> {
        if (element) {
            return sortSiblings(element.children || []);
        }

        const projectItems: ProjectTodoItem[] = [];
        for (const [projectPath, store] of this.store.getStores()) {
            const projectName = path.basename(projectPath);
            const raw = store.getItems();
            
            // Apply filtering logic using standard filters
            const completedFiltered = this.showCompleted ? raw : filterCompleted(raw);
            const filtered = applyPriorityFilter(completedFiltered, this.enabledPriorities);

            if (filtered.length === 0) {
                continue;
            }

            // Decorate items with project information
            const decoratedChildren = decorateItems(filtered, projectName, projectPath);

            const projectItem: ProjectTodoItem = {
                line: -1,
                text: projectName,
                kind: "section",
                checked: false,
                children: decoratedChildren,
                projectName,
                projectPath,
            };
            projectItems.push(projectItem);
        }

        // Sort project folders by name alphabetically
        projectItems.sort((a, b) => a.text.localeCompare(b.text));

        return projectItems;
    }
}

function decorateItems(items: any[], projectName: string, projectPath: string): ProjectTodoItem[] {
    return items.map(item => {
        const decorated: ProjectTodoItem = {
            ...item,
            projectName,
            projectPath,
        };
        if (item.children) {
            decorated.children = decorateItems(item.children, projectName, projectPath);
        }
        return decorated;
    });
}

function sortSiblings(items: ProjectTodoItem[]): ProjectTodoItem[] {
    if (items.length === 0) return items;
    const allCheckboxes = items.every((t) => t.kind === "checkbox");
    if (!allCheckboxes) return items;
    return [
        ...items.filter((t) => !t.checked),
        ...items.filter((t) => t.checked),
    ];
}

/**
 * Recursively count unchecked checkbox items.
 * Since children passed to project nodes are already filtered by
 * {@link filterCompleted} and {@link applyPriorityFilter}, the count
 * naturally excludes archived/completed items when the hide-completed
 * filter is active, and respects the active priority filter.
 */
function countPending(items?: ProjectTodoItem[]): number {
    if (!items || items.length === 0) return 0;
    let count = 0;
    for (const item of items) {
        if (item.kind === "checkbox" && !item.checked) {
            count++;
        }
        if (item.children) {
            count += countPending(item.children);
        }
    }
    return count;
}
