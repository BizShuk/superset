// mDNS One-Click Connect — pure helper that decides what command to
// run given an mDNS service record. See
// `docs/backlog/2026-06-23-feature-mdns-one-click-connect.md` for
// the design rationale. No `vscode` import, no I/O — pure function
// over the MdnsService shape so the caller (a vscode.commands handler)
// can spawn the resulting terminal via the existing PTY wiring.

import type { MdnsService } from "./mdns/types";

export interface ConnectCommand {
    /** Command to invoke, e.g. `"ssh"` or `"open"`. */
    readonly cmd: string;
    /** Argument vector (already quoted-safe by the caller if needed). */
    readonly args: readonly string[];
}

/** Service types that resolve to `ssh <user>@<host>`. */
const SSH_TYPES = new Set(["_ssh._tcp", "_sftp._tcp"]);

/** Service types that resolve to `open <scheme>://<host>:<port>`. */
const HTTP_TYPES = new Set(["_http._tcp", "_https._tcp"]);

/** Service types that resolve to `open <scheme>://<host>:<port>`. */
const IPP_TYPES = new Set(["_ipp._tcp", "_ipps._tcp"]);

/**
 * Resolve the connect command for a given mDNS service.
 *
 * @returns `{ cmd, args }` when the service type is recognised and
 *          the service carries enough metadata to construct a target;
 *          `null` otherwise (caller should fall back to a quick-pick
 *          or warn the user).
 */
export function resolveConnectCommand(
    svc: Pick<
        MdnsService,
        "name" | "host" | "addresses" | "port" | "type"
    >
): ConnectCommand | null {
    const target = svc.host ?? svc.addresses[0];
    if (!target) return null;

    if (SSH_TYPES.has(svc.type)) {
        // mDNS SSH instance names often follow the "user@host"
        // convention (e.g. "pi@nas"). The "host" part is the
        // shortname — we always need to use the resolved FQDN
        // (target) so ssh reaches the right machine. Extract just
        // the user half from the name when present, otherwise
        // fall back to a generic "user" placeholder.
        const user = svc.name.includes("@")
            ? svc.name.split("@")[0]!
            : "user";
        return { cmd: "ssh", args: [`${user}@${target}`] };
    }
    if (HTTP_TYPES.has(svc.type)) {
        const scheme = svc.type === "_https._tcp" ? "https" : "http";
        return {
            cmd: "open",
            args: [`${scheme}://${target}:${svc.port}`],
        };
    }
    if (IPP_TYPES.has(svc.type)) {
        const scheme = svc.type === "_ipps._tcp" ? "ipps" : "ipp";
        return {
            cmd: "open",
            args: [`${scheme}://${target}:${svc.port}`],
        };
    }
    return null;
}