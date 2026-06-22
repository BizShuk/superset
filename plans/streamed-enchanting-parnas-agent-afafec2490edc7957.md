# VSCode TreeView Drag-and-Drop API Research

Research findings on VSCode's TreeView drag-and-drop API surface (stable API only) and how it relates to the existing superset codebase.

## 1. Stable Tree Drag-and-Drop API Surface

### `TreeDragAndDropController<T>` interface
Location: `/Users/bytedance/projects/superset/node_modules/@types/vscode/index.d.ts:12056-12115`

Stable interface for implementing drag-and-drop on a `TreeView`. Three members:

- `readonly dropMimeTypes: readonly string[]` (line 12075)
  - Lists mime types the controller's `handleDrop` supports.
  - For inter-tree support, add the source tree's mime type (e.g. `application/vnd.code.tree.<treeidlowercase>`).
  - Use the special `"files"` mime type to accept any dropped file regardless of file mime.

- `readonly dragMimeTypes: readonly string[]` (line 12083)
  - Lists mime types `handleDrag` may add.
  - The recommended tree mime type `application/vnd.code.tree.<treeidlowercase>` is auto-added.

- `handleDrag?(source, dataTransfer, token)` (line 12103)
  - Called when user starts dragging items from this tree.
  - `source: readonly T[]` — items being dragged.
  - `dataTransfer: DataTransfer` — can add custom `DataTransferItem`s.
  - To drag into the editor, use `text/uri-list` with newline-joined `Uri.toString()`s.
  - Mime types added here are NOT available outside the application.

- `handleDrop?(target, dataTransfer, token)` (line 12114)
  - Called when drop completes on a tree item in this tree.
  - `target: T | undefined` — `undefined` means drop is on the root.
  - Extensions MUST fire `onDidChangeTreeData` for affected elements after the drop.

### `DataTransfer` and `DataTransferItem` classes
Location: lines 11979-12051

- `class DataTransferItem`
  - `asString(): Thenable<string>` — stringifies `value`.
  - `asFile(): DataTransferFile | undefined` — file metadata for dropped files.
  - `readonly value: any` — the original object passed to the constructor (preserved when both source and target run in the same extension host).
  - Constructor: `new DataTransferItem(value: any)`.

- `class DataTransfer` (implements `Iterable<[mimeType, item]>`)
  - `get(mimeType: string): DataTransferItem | undefined` — case-insensitive.
  - `set(mimeType: string, value: DataTransferItem): void`.
  - `forEach`, `[Symbol.iterator]`.

- `interface DataTransferFile` (line 11957) — read-only `name`, optional `uri`, `data(): Thenable<Uint8Array>`.

### `TreeViewOptions<T>` interface
Location: lines 11854-11915

Constructor options for `vscode.window.createTreeView`. Members:
- `treeDataProvider: TreeDataProvider<T>` (required)
- `showCollapseAll?: boolean`
- `canSelectMany?: boolean`
- `dragAndDropController?: TreeDragAndDropController<T>` (line 11876) — the entry point that wires drag-and-drop into the tree.
- `manageCheckboxStateManually?: boolean`

### `TreeView<T>` interface
Location: lines 12146-12233

Public API of a created tree view:
- `onDidExpandElement: Event<TreeViewExpansionEvent<T>>`
- `onDidCollapseElement: Event<TreeViewExpansionEvent<T>>`
- `selection: readonly T[]`
- `onDidChangeSelection: Event<TreeViewSelectionChangeEvent<T>>`
- `visible: boolean`
- `onDidChangeVisibility: Event<TreeViewVisibilityChangeEvent>`
- `onDidChangeCheckboxState: Event<TreeCheckboxChangeEvent<T>>`
- `message?: string`
- `title?: string`
- `description?: string`
- `badge?: ViewBadge | undefined`
- `reveal(element, options?)` (line 12219) — only works when `TreeDataProvider.getParent` is implemented.

NOTE: The `TreeView` interface itself has NO `onDidDrop` / `onDrag` events. Drag-and-drop is wired exclusively through `TreeViewOptions.dragAndDropController`. The `TreeView` only exposes expansion, selection, visibility, and checkbox events.

### `TreeItem` class
Location: lines 12302-12415

Properties relevant to drag-and-drop / nested layouts:
- `label?: string | TreeItemLabel`
- `id?: string` (line 12313) — optional unique id; preserves selection/expansion state across updates.
- `iconPath?: string | IconPath | ThemeIcon`
- `description?: string | boolean`
- `resourceUri?: Uri`
- `tooltip?: string | MarkdownString | undefined`
- `command?: Command`
- `collapsibleState?: TreeItemCollapsibleState` (line 12356) — `None | Collapsed | Expanded`.
- `contextValue?: string` — used in `view/item/context` `when` clauses.
- `accessibilityInformation?: AccessibilityInformation`
- `checkboxState?: TreeItemCheckboxState | { state, tooltip?, accessibilityInformation? }`

IMPORTANT: `TreeItem` does NOT have a `parent` property. The parent relationship is established through the `TreeDataProvider.getParent` method (lines 12264-12273), not on the item itself.

### `TreeItemCollapsibleState` enum
Location: lines 12420-12433
- `None = 0`, `Collapsed = 1`, `Expanded = 2`.

### `TreeDataProvider<T>` interface
Location: lines 12238+
- `onDidChangeTreeData?: Event<T | T[] | undefined | null | void>`
- `getTreeItem(element: T): TreeItem | Thenable<TreeItem>`
- `getChildren(element?: T): ProviderResult<T[]>`
- `getParent?(element: T): ProviderResult<T>` — REQUIRED for `TreeView.reveal` to work.
- `resolveTreeItem?(item, element, token): ProviderResult<TreeItem>` — used to resolve tooltip/command lazily.

## 2. Existing Drag-Drop Patterns in the Codebase

Searched for `TreeDragAndDropController`, `dragAndDropController`, `handleDrag`, `handleDrop`, `DataTransfer`, `onDidDrop`, `onDrag` outside `node_modules`. Result: NO matches in `src/`.

The current tree view at `/Users/bytedance/projects/superset/src/extension.ts:82-85` is created with only `treeDataProvider` and no `dragAndDropController`:

```ts
const treeView = vscode.window.createTreeView(
    "superset.terminals",
    { treeDataProvider: treeProvider }
);
```

Other source files inspected: `outputWatcher.ts`, `treeSpec.ts`, `treeProvider.ts`, `terminalRegistry.ts`, `types.ts`, `ptyTerminalHost.ts`, `highlightPresenter.ts`, `autoReplace.ts`. None implement drag-and-drop. Drag-drop would be a net-new feature.

## 3. Existing `views` Configuration in `package.json`

Location: `/Users/bytedance/projects/superset/package.json:60-77`

```json
"viewsContainers": {
    "activitybar": [
        { "id": "superset", "title": "Terminals", "icon": "images/icon.png" }
    ]
},
"views": {
    "superset": [
        { "id": "superset.terminals", "name": "Terminals", "contextualTitle": "Superset" }
    ]
}
```

Single container `superset` in the activity bar, hosting a single view `superset.terminals`. The `"superset"` key in the `views` block is the container id; each entry has its own `id` used by `vscode.window.createTreeView`. Multiple views can be declared in the same container array, which is the supported mechanism for grouped/nested views (no `group`/`nested` property on views themselves — grouping is done by container, or by the `when` clause on commands/menus).

The current menus config (lines 78-113) includes `view/title` and `view/item/context` keyed on `view == superset.terminals` and `viewItem == terminal`. New view ids can be added to the same `views.superset` array with their own `when` clauses, and a new `treeDataProvider` (plus optional `dragAndDropController`) registered with `createTreeView`.

## Summary of API Capabilities (Stable)

- Drag-and-drop is opt-in via `TreeViewOptions.dragAndDropController` — there is no first-class `onDidDrop` event on `TreeView`.
- Same-tree drops preserve `DataTransferItem.value` objects (so extensions can round-trip typed payloads).
- Cross-tree drops require both source and target controllers to declare each other's `application/vnd.code.tree.<id>` mime type in `dropMimeTypes`.
- Editor drops use the special `text/uri-list` mime type with `\r\n`-joined `Uri.toString()` values.
- File drops use the special `"files"` mime type and arrive as `DataTransferItem` whose `asFile()` returns a `DataTransferFile`.
- The recommended tree-specific mime type is `application/vnd.code.tree.<treeidlowercase>` and is auto-added to the drag transfer (but must still be listed in `dropMimeTypes` for drops to be received).
- There is no `onDidDrop` event; `handleDrop(target, dataTransfer, token)` is the only callback. State mutations should be followed by firing `onDidChangeTreeData` on the `TreeDataProvider`.
- Tree items have no `parent` field; parent relationships live on the `TreeDataProvider` via `getParent`.
- Tree grouping is achieved by registering multiple views in the same `viewsContainers` entry (e.g. `views.superset` can hold several view ids), not via a `group`/`nested` flag on the view itself.

## Key File References

- `/Users/bytedance/projects/superset/node_modules/@types/vscode/index.d.ts` — full API
  - Lines 11854-11915: `TreeViewOptions`
  - Lines 12056-12115: `TreeDragAndDropController`
  - Lines 11957-12051: `DataTransferFile`, `DataTransferItem`, `DataTransfer`
  - Lines 12146-12233: `TreeView`
  - Lines 12238-12290: `TreeDataProvider`
  - Lines 12302-12415: `TreeItem`
  - Lines 12420-12433: `TreeItemCollapsibleState`
- `/Users/bytedance/projects/superset/package.json:60-113` — `viewsContainers`, `views`, and `menus` config
- `/Users/bytedance/projects/superset/src/extension.ts:64-92` — current single-tree wiring (no `dragAndDropController`)
- `/Users/bytedance/projects/superset/src/treeProvider.ts` — current `TerminalTreeProvider`
- `/Users/bytedance/projects/superset/src/treeSpec.ts` — type spec for tree items
- `/Users/bytedance/projects/superset/src/types.ts` — shared types
