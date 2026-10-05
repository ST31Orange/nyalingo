/**
 * 离线翻译引擎（MTranServer）探测工具。
 * 纯逻辑 + 注入 HttpTransport，便于单元测试。
 */
import type { HttpTransport } from "./http";

export interface ProbeResult {
	/** 引擎是否可访问（2xx 且响应可解析） */
	running: boolean;
	endpoint: string;
	detail?: string;
	error?: string;
}

/** 规范化地址：去尾部斜杠。 */
export function normalizeEndpoint(endpoint: string): string {
	return endpoint.trim().replace(/\/+$/, "");
}

/**
 * 探测本地离线翻译引擎（MTranServer 兼容）：
 * 1. GET  {endpoint}/languages  → 2xx 即运行中
 * 2. 否则 POST {endpoint}/translate（ok 短文本）→ 2xx 且含译文即运行中
 * 永不抛出；失败返回 running=false。
 */
export async function probeOfflineServer(http: HttpTransport, endpoint: string, timeoutMs = 4000): Promise<ProbeResult> {
	const base = normalizeEndpoint(endpoint);
	if (!base) return { running: false, endpoint, error: "未填写地址" };

	try {
		const res = await http.request({ url: `${base}/languages`, method: "GET", timeoutMs });
		if (res.status >= 200 && res.status < 300) {
			let detail = "运行中";
			try {
				const data = JSON.parse(res.body) as { languages?: unknown[] };
				if (Array.isArray(data.languages)) detail = `运行中（${data.languages.length} 种语言）`;
			} catch {
				/* 不要求 body 可解析 */
			}
			return { running: true, endpoint: base, detail };
		}
	} catch {
		/* 继续策略二 */
	}

	try {
		const res = await http.request({
			url: `${base}/translate`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ from: "auto", to: "zh-Hans", text: "ok", html: false }),
			timeoutMs,
		});
		if (res.status >= 200 && res.status < 300) {
			return { running: true, endpoint: base, detail: "运行中（可翻译）" };
		}
		return { running: false, endpoint: base, error: `服务器返回 HTTP ${res.status}` };
	} catch (e) {
		return { running: false, endpoint: base, error: `连接失败：${e instanceof Error ? e.message : String(e)}` };
	}
}
