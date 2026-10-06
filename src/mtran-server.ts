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

/**
 * 返回一个可写的本地数据目录（用于 MTranServer 的配置与模型）。
 * 默认的 ~/.config/mtran 在某些 Windows 机器上被 ACL 限制（只读），
 * 导致 mtranserver 启动时报 EPERM，因此显式指定到 AppData。
 */
function writableDataDir(): string {
	const platform = process.platform;
	if (platform === "win32") {
		const base = process.env.LOCALAPPDATA || process.env.APPDATA || process.env.USERPROFILE || "";
		return base ? `${base.replace(/\\/g, "/").replace(/\/+$/, "")}/mtranserver` : "";
	}
	if (platform === "darwin") {
		const home = process.env.HOME || "";
		return home ? `${home}/Library/Application Support/mtranserver` : "";
	}
	const xdg = process.env.XDG_DATA_HOME || (process.env.HOME ? `${process.env.HOME}/.local/share` : "");
	return xdg ? `${xdg.replace(/\/+$/, "")}/mtranserver` : "";
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

	const dataDir = writableDataDir();
	const serverArgs = dataDir ? ["--config-dir", `${dataDir}/config`, "--model-dir", `${dataDir}/models`] : [];

	const candidates: Array<{ cmd: string; args: string[]; label: string }> = [
		{ cmd: "mtranserver", args: serverArgs, label: "mtranserver" },
		{ cmd: "npx", args: ["--yes", "mtranserver", ...serverArgs], label: "npx mtranserver" },
	];

	let lastError = "";
	for (const c of candidates) {
		try {
			// Windows 上 npm 全局命令是 .cmd/.ps1 包装脚本，spawn 需要 shell 才能解析；
			// 命令为固定常量，无注入风险。
			const child = cp.spawn(c.cmd, c.args, {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
				shell: process.platform === "win32",
			});
			child.unref();
			child.on("error", (err) => {
				lastError = `${c.cmd} 启动失败：${err.message}`;
			});
			const ok = await waitForServer(http, endpoint, timeoutMs);
			if (ok) {
				// 服务已就绪：后台预下载中英互译模型（en-zh / zh-en），
				// 避免首次翻译因下载模型超时。
				downloadDefaultModels(cp, dataDir);
				return { ok: true, detail: `已通过 ${c.label} 启动`, pid: child.pid };
			}
			lastError = `${c.label} 已启动但服务未就绪（可能仍在下载模型）。`;
		} catch (e) {
			lastError = `${c.cmd} 启动失败：${e instanceof Error ? e.message : String(e)}`;
		}
	}
	return { ok: false, detail: lastError || "无法启动 MTranServer。" };
}

/** 后台预下载默认语言对（中英互译）模型，非阻塞、失败静默。 */
function downloadDefaultModels(cp: ReturnType<typeof requireChildProcess>, dataDir: string): void {
	if (!cp || !dataDir) return;
	try {
		const child = cp.spawn("mtranserver", ["--download", "en-zh", "zh-en", "--config-dir", `${dataDir}/config`, "--model-dir", `${dataDir}/models`], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			shell: process.platform === "win32",
		});
		child.unref();
	} catch {
		/* 预下载失败不影响翻译服务主流程 */
	}
}
