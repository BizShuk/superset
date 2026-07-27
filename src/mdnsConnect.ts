// mDNS One-Click Connect — pure helper that decides what command to
// run given an mDNS service record. See
// `docs/backlog/2026-06-23-feature-mdns-one-click-connect.md` for
// the design rationale. No `vscode` import, no I/O — pure function
// over the MdnsService shape so the caller can keep external URIs away
// from the shell and quote terminal arguments at the final boundary.

import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type { MdnsService } from "./mdns/types";

export interface TerminalConnectAction {
    readonly kind: "terminal";
    readonly cmd: "ssh";
    readonly args: readonly string[];
}

export interface ExternalConnectAction {
    readonly kind: "external";
    readonly uri: string;
}

export type ConnectAction = TerminalConnectAction | ExternalConnectAction;

/** Service types that resolve to `ssh <user>@<host>`. */
const SSH_TYPES = new Set(["_ssh._tcp", "_sftp._tcp"]);

/** Service types that resolve to an external HTTP(S) URI. */
const HTTP_TYPES = new Set(["_http._tcp", "_https._tcp"]);

/** Service types that resolve to an external IPP(S) URI. */
const IPP_TYPES = new Set(["_ipp._tcp", "_ipps._tcp"]);
const SSH_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const DNS_LABEL_RE =
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function validPort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function normalizeTarget(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (/[\u0000-\u0020\u007f]/.test(value)) return undefined;
    const target = value.endsWith(".") ? value.slice(0, -1) : value;
    if (isIP(target) !== 0) return target;

    const ascii = domainToASCII(target);
    if (
        !ascii ||
        Buffer.byteLength(ascii, "utf8") > 253 ||
        ascii.includes("..")
    ) {
        return undefined;
    }
    return ascii.split(".").every((label) => DNS_LABEL_RE.test(label))
        ? ascii
        : undefined;
}

function externalHost(target: string): string {
    return isIP(target) === 6 ? `[${target}]` : target;
}

/**
 * Resolve the connect command for a given mDNS service.
 *
 * @returns A typed terminal/external action only after every network-provided
 *          field has passed validation; `null` otherwise.
 */
export function resolveConnectCommand(
    svc: Pick<
        MdnsService,
        "name" | "host" | "addresses" | "port" | "type"
    >
): ConnectAction | null {
    if (!validPort(svc.port)) return null;
    const target = normalizeTarget(svc.host ?? svc.addresses[0]);
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
        if (!SSH_USER_RE.test(user)) return null;
        return {
            kind: "terminal",
            cmd: "ssh",
            args: [`${user}@${target}`],
        };
    }
    if (HTTP_TYPES.has(svc.type)) {
        const scheme = svc.type === "_https._tcp" ? "https" : "http";
        return {
            kind: "external",
            uri: `${scheme}://${externalHost(target)}:${svc.port}`,
        };
    }
    if (IPP_TYPES.has(svc.type)) {
        const scheme = svc.type === "_ipps._tcp" ? "ipps" : "ipp";
        return {
            kind: "external",
            uri: `${scheme}://${externalHost(target)}:${svc.port}`,
        };
    }
    return null;
}
