/**
 * MTranServer 本地服务启动器。
 * 通过 Electron 的 child_process 启动 mtranserver CLI（或 npx），
 * 并探测 8989 端口是否就绪。桌面端可用；移动端/Web 环境会优雅降级。
 */
import type { HttpTransport } from "./http";
import { probeOfflineServer } from "./offline-probe";

export interface StartServerResult {
	ok: boolean;
	detail?: string;
	pid?: number;
}

function requireChildProcess(): typeof import("child_process") | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require("child_process") as typeof import("child_process");
	} catch {
		return null;
	}
}

/** 探测服务是否已就绪（间隔轮询，直到超时）。 */
async function waitForServer(http: HttpTransport, endpoint: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const r = await probeOfflineServer(http, endpoint, 2000);
		if (r.running) return true;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	return false;
}

/**
 * 启动本地离线翻译服务（MTranServer）。
 * 1. 已运行则直接返回成功；
 * 2. 否则依次尝试 `mtranserver` 与 `npx mtranserver` 后台启动并等待就绪。
 */
export async function startOfflineServer(http: HttpTransport, endpoint: string, timeoutMs = 45000): Promise<StartServerResult> {
	const already = await probeOfflineServer(http, endpoint, 2000);
	if (already.running) return { ok: true, detail: "已在运行" };

	const cp = requireChildProcess();
	if (!cp) return { ok: false, detail: "当前环境无法启动本地服务（缺少 Node child_process）。请手动安装并启动 MTranServer。" };

	const candidates: Array<{ cmd: string; args: string[]; label: string }> = [
		{ cmd: "mtranserver", args: [], label: "mtranserver" },
		{ cmd: "npx", args: ["--yes", "mtranserver"], label: "npx mtranserver" },
	];

	let lastError = "";
	for (const c of candidates) {
		try {
			const child = cp.spawn(c.cmd, c.args, { detached: true, stdio: "ignore", windowsHide: true });
			child.unref();
			const ok = await waitForServer(http, endpoint, timeoutMs);
			if (ok) return { ok: true, detail: `已通过 ${c.label} 启动`, pid: child.pid };
			lastError = `${c.label} 已启动但服务未就绪（可能仍在下载模型）。`;
		} catch (e) {
			lastError = `${c.cmd} 启动失败：${e instanceof Error ? e.message : String(e)}`;
		}
	}
	return { ok: false, detail: lastError || "无法启动 MTranServer。" };
}
