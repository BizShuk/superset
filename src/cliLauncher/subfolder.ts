// CLI Launcher direct-subfolder filesystem domain。
//
// 這層不依賴 `vscode`：只接受已解析的 parent path 與單一 path segment，
// 驗證後以 non-recursive mkdir 建立 direct child。

import { mkdir } from "node:fs/promises";
import * as path from "node:path";

/** Input Box 與 filesystem boundary 共用的單層名稱驗證。 */
export function validateSubfolderName(raw: string): string | undefined {
    const name = raw.trim();
    if (name === "") {
        return "請輸入子資料夾名稱。";
    }
    if (name === "." || name === "..") {
        return "子資料夾名稱不可為 . 或 ..。";
    }
    if (name.includes("/") || name.includes("\\")) {
        return "請只輸入一層子資料夾名稱，不可包含 / 或 \\。";
    }
    if (name.includes("\0")) {
        return "子資料夾名稱包含不支援的字元。";
    }
    return undefined;
}

/** 建立一個 direct child；既存目錄與無效 parent 由 mkdir 明確報錯。 */
export async function createSubfolder(
    parentPath: string,
    rawName: string
): Promise<string> {
    const validation = validateSubfolderName(rawName);
    if (validation) {
        throw new Error(validation);
    }

    const target = path.join(parentPath, rawName.trim());
    await mkdir(target);
    return target;
}
