import * as vscode from "vscode";
import { isGroup } from "./treeProvider";
import { GroupStore, UNGROUPED_ID, type Group } from "./groupStore";

const DND_MIME = "application/vnd.code.tree.superset.terminals/dnd";

/**
 * Build the TreeView drag-and-drop controller for the terminals panel:
 * terminals move between groups; groups reorder. Extracted from the feature
 * composition root so the wiring is named and self-contained.
 */
export function createTerminalDragAndDropController(
    groupStore: GroupStore,
    treeProvider: { refresh(): void }
): vscode.TreeDragAndDropController<Group | vscode.Terminal> {
    return {
        dragMimeTypes: [DND_MIME],
        dropMimeTypes: [DND_MIME],
        handleDrag: (source, dataTransfer) => {
            for (const item of source) {
                if (isGroup(item)) {
                    dataTransfer.set(
                        DND_MIME,
                        new vscode.DataTransferItem({
                            kind: "group",
                            id: (item as Group).id,
                        })
                    );
                } else {
                    dataTransfer.set(
                        DND_MIME,
                        new vscode.DataTransferItem({
                            kind: "terminal",
                            terminal: item,
                        })
                    );
                }
            }
        },
        handleDrop: (target, dataTransfer) => {
            const dropped: vscode.DataTransferItem[] = [];
            dataTransfer.forEach((item) => dropped.push(item));
            for (const item of dropped) {
                const value = item.value as {
                    kind: "group" | "terminal";
                    id?: string;
                    terminal?: vscode.Terminal;
                };
                if (value.kind === "terminal" && value.terminal) {
                    const targetGroupId = isGroup(target)
                        ? (target as Group).id
                        : UNGROUPED_ID;
                    groupStore.moveTerminalToGroup(
                        value.terminal,
                        targetGroupId
                    );
                } else if (value.kind === "group" && value.id) {
                    groupStore.moveGroup(
                        value.id,
                        groupStore.getGroups().length - 1
                    );
                }
            }
            treeProvider.refresh();
        },
    };
}
