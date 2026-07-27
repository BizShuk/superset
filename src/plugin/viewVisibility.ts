import * as vscode from "vscode";

type VisibilityAwareView<T> = Pick<
    vscode.TreeView<T>,
    "visible" | "onDidChangeVisibility"
>;

/**
 * Shared Tree View visibility boundary.
 *
 * VS Code emits a `TreeViewVisibilityChangeEvent`, not a boolean. Keeping the
 * destructuring here prevents feature modules from accidentally treating the
 * event object itself as an always-truthy visibility flag.
 */
export function registerViewVisibility<T>(
    view: VisibilityAwareView<T>,
    viewId: string,
    onVisibilityChange?: (visible: boolean) => void
): vscode.Disposable {
    onVisibilityChange?.(view.visible);
    return view.onDidChangeVisibility(({ visible }) => {
        onVisibilityChange?.(visible);
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                viewId
            );
        }
    });
}
